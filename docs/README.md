# AbstractFlow Documentation

AbstractFlow is the AbstractFramework visual workflow editor. It is distributed as the npm package `@abstractframework/flow`.

Normal operation:

1. AbstractGateway runs on a server or local machine.
2. AbstractFlow serves the browser editor.
3. The browser signs in with a Gateway user token.
4. Flow proxies authoring, discovery, run, ledger, and artifact calls to Gateway.

AbstractFlow does not own runtime execution or provider secrets. Gateway and Runtime do.

## Pages

- [Getting started](getting-started.md)
- [Web editor](web-editor.md)
- [Architecture](architecture.md)
- [API and contracts](api.md)
- [VisualFlow JSON](visualflow.md)
- [CLI](cli.md)
- [FAQ](faq.md)

## Maintainer Notes

- Keep docs written around the web package layout: `src/`, `bin/`, `examples/flows/`, `docs/`.
- Do not add Python package or local server launch instructions; those surfaces were removed from this repository.
- Regenerate the LLM context after doc changes:

```bash
npm run docs:llms
```
