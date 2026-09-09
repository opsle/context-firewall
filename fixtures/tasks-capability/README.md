# Pinned Tasks compatibility evidence

`upstream/` contains byte-for-byte reference files from
https://github.com/opsle/tasks at
`50f2666b2ddf3b95fc77c7e7bd8d64b6807e91f8`, obtained with read-only Git
object reads. `provenance.json` records every SHA-256 and the authoritative
Context Firewall baseline. Upstream's MIT license is retained alongside them.
The `.txt` suffix prevents upstream tests from joining the local test catalog.
No retained attempt is used as implementation authority.

`tests/tasks-capability.test.js` requires all listed files and verifies their
hashes before executing the generic loader. The loader is copied unchanged into
a temporary ESM root. Three host integration modules are test-only throwing
stubs: execution, model gateway, and provider metadata. These imports are unused
by deterministic `command.evidence` with explicit selection. Reaching them fails
the test. Loader discovery, manifest validation, grants, configuration, health,
invocation, result validation, private receipt dispatch, and byte checks are
real pinned code, not reimplementations.

The adapter and reduction bridge preserve the pinned source exactly except for
package-owned import paths. `utils.js` preserves only the two used upstream
helpers, `sourceRevision` and `capabilityResult`. The manifest changes version,
disables implicit enablement, removes legacy config aliases and the repository
default, and resolves an explicitly configured repository relative to its own
manifest. Hook authority/execution/failure schemas remain unchanged.

Adapter/boundary/repair/Visible Value tests are provenance references only.
Package-relevant assertions are implemented in the local regression; no upstream
runner, provider, database, or external tool is started. Fixture updates require
reviewed revision and hash updates, with the full local catalog required again.
