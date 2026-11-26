# WhatsApp QR connect: progress

## Decision queue

### Closing review did not converge (whatsapp-qr-connect/closing)

- **Status:** parked. The rsc ledger refused a panel record after 3 review rounds without convergence.
- **Branch:** `feat/whatsapp-qr-connect`, HEAD `b7de757`, not pushed.
- **Commits since the last pushed state:** `9c55e41` (restart a line stuck in connecting), `1c7505c` (re-read the line state before restarting), `b7de757` (tests for the re-read and the single restart).
- **Evidence:** 37/37 WhatsApp tests pass, `tsc --noEmit` clean. Refuters (correctness, security, tests) found no blockers on the final code; the tests lens gaps are closed and re-verified by mutation.
- **Open risks:**
  - Nothing verified against production Evolution: whether a restart really yields a QR for a stuck line is untested.
  - "Not open" check trusts the webhook-stored state; a missed `open` webhook could restart a live line.
  - Tenant slug is not restricted to a safe charset and the instance name is not URL-encoded (same pattern as every Evolution call).
- **Decision needed:** accept the panel as-is and push, or rethink the closing review before pushing.
