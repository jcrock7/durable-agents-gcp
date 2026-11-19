"""Mock model provider for the LiteLLM gateway: canned answers, no model calls, no cost.

Used on k3d when LOCAL_MODELS=mock (scripts/local/apply-k8s.sh points the "fast" and "smart"
aliases at mock/fast and mock/smart). Agents, virtual keys, budgets and the guardrail work as
usual; only the model call is replaced, so everything except answer quality can be tested
for free: workflows, retries, crash recovery, human review, the UI.

Answers:
  - Structured output (response_format json_schema): a minimal object that satisfies the
    schema (required fields, array minimums, enums, number bounds).
  - JSON mode without a schema: {"mock": true}
  - Otherwise: a short plain-text sentence.

Settings (environment):
  MOCK_LATENCY_SECONDS  delay before answering, so a run can be interrupted mid-call (default 2)
  MOCK_FAILURE_RATE     fraction of calls that fail with HTTP 503, to exercise retries (default 0)
"""

import asyncio
import json
import os
import random
import time

from litellm.llms.custom_llm import CustomLLM, CustomLLMError
from litellm.types.utils import Choices, Message, ModelResponse, Usage

PLAIN_TEXT = "Mock response: no model was called."


def sample(schema, name="value", root=None, depth=0):
    """Smallest value that satisfies a JSON Schema (the subset AI SDK and Zod produce)."""
    root = root if root is not None else schema
    if not isinstance(schema, dict) or depth > 12:
        return None
    if "$ref" in schema:
        ref = schema["$ref"]
        if ref == "#":
            return None  # recursive schema: stop here
        target = root
        for part in ref.lstrip("#/").split("/"):
            target = target.get(part, {}) if isinstance(target, dict) else {}
        return sample(target, name, root, depth + 1)
    if "const" in schema:
        return schema["const"]
    if schema.get("enum"):
        return schema["enum"][0]
    for key in ("anyOf", "oneOf"):
        options = [s for s in schema.get(key, []) if isinstance(s, dict) and s.get("type") != "null"]
        if options:
            return sample(options[0], name, root, depth + 1)
    if schema.get("allOf"):
        merged = {}
        for part in schema["allOf"]:
            if isinstance(part, dict):
                merged.update(part)
        return sample(merged, name, root, depth + 1)

    kind = schema.get("type")
    if isinstance(kind, list):
        kind = next((k for k in kind if k != "null"), "null")
    if kind is None:
        kind = "object" if "properties" in schema else "array" if "items" in schema else "string"

    if kind == "object":
        props = schema.get("properties") or {}
        return {key: sample(sub, key, root, depth + 1) for key, sub in props.items()}
    if kind == "array":
        count = max(int(schema.get("minItems", 1)), 1)
        if "maxItems" in schema:
            count = min(count, int(schema["maxItems"]))
        return [sample(schema.get("items", {}), name, root, depth + 1) for _ in range(count)]
    if kind in ("integer", "number"):
        # 1 where allowed (a valid source number, count or id), else the nearest bound.
        value = max(1, schema.get("minimum", 1))
        if "exclusiveMinimum" in schema:
            value = max(value, schema["exclusiveMinimum"] + 1)
        if "maximum" in schema:
            value = min(value, schema["maximum"])
        return int(value) if kind == "integer" else float(value)
    if kind == "boolean":
        return False
    if kind == "null":
        return None
    text = f"Mock {name} [1]."
    min_len = int(schema.get("minLength", 0))
    if len(text) < min_len:
        text = text + " " + "x" * (min_len - len(text) - 1)
    if "maxLength" in schema:
        text = text[: int(schema["maxLength"])]
    return text


def mock_content(response_format):
    """Answer text for a request, based on its response_format."""
    if isinstance(response_format, dict):
        if response_format.get("type") == "json_schema":
            spec = response_format.get("json_schema") or {}
            return json.dumps(sample(spec.get("schema") or {}))
        if response_format.get("type") == "json_object":
            return json.dumps({"mock": True})
    return PLAIN_TEXT


class MockLLM(CustomLLM):
    def _respond(self, model, messages, optional_params):
        rate = float(os.environ.get("MOCK_FAILURE_RATE", "0"))
        if rate > 0 and random.random() < rate:
            raise CustomLLMError(status_code=503, message="Mock failure (MOCK_FAILURE_RATE)")
        content = mock_content((optional_params or {}).get("response_format"))
        prompt_chars = sum(len(str(m.get("content", ""))) for m in messages or [] if isinstance(m, dict))
        prompt_tokens, completion_tokens = prompt_chars // 4 + 1, len(content) // 4 + 1
        return ModelResponse(
            model=model,
            choices=[Choices(index=0, finish_reason="stop", message=Message(role="assistant", content=content))],
            usage=Usage(
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=prompt_tokens + completion_tokens,
            ),
        )

    @staticmethod
    def _latency():
        return float(os.environ.get("MOCK_LATENCY_SECONDS", "2"))

    def completion(self, model, messages, *args, optional_params=None, **kwargs):
        time.sleep(self._latency())
        return self._respond(model, messages, optional_params)

    async def acompletion(self, model, messages, *args, optional_params=None, **kwargs):
        await asyncio.sleep(self._latency())
        return self._respond(model, messages, optional_params)


mock_llm = MockLLM()
