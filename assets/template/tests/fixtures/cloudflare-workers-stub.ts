// Unit tests run in Node, where the `cloudflare:workers` module does not exist. Modules that only import it
// for `env` load against this empty environment, and no test here reads a binding.
export const env = {}
