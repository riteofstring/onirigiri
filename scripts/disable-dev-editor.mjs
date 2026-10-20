export function disableDevEditor() {
  return {
    name: "onirigiri:disable-dev-editor",
    apply: "serve",
    enforce: "pre",
    configureServer(server) {
      const deny = (_request, response) => {
        response.statusCode = 404;
        response.end();
      };
      server.middlewares.use("/__open-in-editor", deny);
      if (server.config.base !== "/") {
        server.middlewares.use(`${server.config.base}__open-in-editor`, deny);
      }
    },
  };
}
