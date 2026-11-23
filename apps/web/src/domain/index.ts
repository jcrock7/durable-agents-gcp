import type { ComponentType } from "react";
import type { ActionProps, CaseProps } from "../CaseParts.js";
import { InvoiceActions, InvoiceCase } from "./invoice-exception-resolver.js";
import { ResearchActions, ResearchCase, ResearchEmpty } from "./research-summarize.js";

/**
 * Each built agent's domain layer (docs/design/agent-portal/agent-screen-guidelines.md): its case sheet, its
 * agent-page actions and its empty-queue text. Shared components look an agent up here and never name a domain.
 */
export const DOMAIN: Record<string, { Case: ComponentType<CaseProps>; Actions?: ComponentType<ActionProps>; Empty?: ComponentType<{ demoControls: boolean }> }> = {
  "invoice-exception-resolver": { Case: InvoiceCase, Actions: InvoiceActions },
  "research-summarize": { Case: ResearchCase, Actions: ResearchActions, Empty: ResearchEmpty },
};
