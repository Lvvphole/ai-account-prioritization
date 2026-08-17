# OpenAI Agents Bridge

This package isolates the OpenAI Agents SDK and its Zod 4 peer from the existing Zod 3 runtime packages.

Current P4 use is limited to one bounded drafting or synthesis model turn through the Responses API. The bridge disables Agents SDK tracing and OpenAI client retries. It does not configure tools, handoffs, MCP, sessions, subagents, provider routing, or side effects.

The package is not a production-admission boundary. `apps/agent-runtime` keeps provider authority behind `RuntimeModelClient` and the production registry.
