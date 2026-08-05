# Support

Doxa is independently owned and maintained by div0ky. Midtown Home Improvements is currently its
sole supported production consumer.

The packages are publicly downloadable under Apache-2.0, but the supported adoption program and
roadmap are closed. External use is permitted without any compatibility, support, warranty, roadmap,
or production-readiness commitment. Public availability does not make an external installation a
supported deployment.

## Officially tested matrix

Doxa's current CI-backed support matrix is:

- Node.js 26.6 or newer within the 26.x line;
- pnpm 11;
- PostgreSQL 16 and 17; and
- Linux x64 through GitHub-hosted Ubuntu CI and the generated Linux container image.

Other operating systems, architectures, package-manager versions, PostgreSQL versions, and runtime
combinations may work, but they are not officially supported until they are part of repeatable
conformance coverage.

- Use GitHub Discussions for questions, design conversations, and help adopting Doxa.
- Use GitHub Issues for reproducible defects and accepted feature work.
- Use private vulnerability reporting for security issues as described in
  [SECURITY.md](SECURITY.md).

When requesting help, include the Doxa version or commit, Node and pnpm versions, operating system,
PostgreSQL version, relevant generated manifest diagnostics, and a minimal reproduction.
