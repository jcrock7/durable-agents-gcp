/** What an agent package hands the worker so it can run that agent. */
export interface AgentRegistration {
  /** Agent name, e.g. "research-summarize". */
  name: string;
  /** Temporal task queue the agent's workflows and activities run on. */
  taskQueue: string;
  /** Path to the compiled workflows entry point (bundled at image build time). */
  workflowsPath: string;
  /**
   * Activity implementations, keyed by name. A function so that bundling workflows at build time
   * doesn't need runtime settings such as the agent's API key.
   */
  createActivities: () => object;
}
