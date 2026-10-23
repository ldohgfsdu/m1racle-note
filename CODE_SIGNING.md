# Code signing policy

Status: unsigned preview. A SignPath Foundation application was submitted on 2026-10-23; the website confirmed submission. Approval and signing access remain pending. No existing binary is represented as signed by SignPath Foundation.

Proposed source maintainer, reviewer and signing approver: [ldohgfsdu](https://github.com/ldohgfsdu). The account owner has confirmed that GitHub two-factor authentication is enabled. SignPath account enrollment, its multi-factor authentication and signing-role configuration remain pending.

Release artifacts must be produced from the public source revision using a verifiable build pipeline. Each signing request requires manual maintainer approval. Application, installer and uninstaller signing must be handled explicitly; upstream dependencies retain their own identity and licenses.

If the project is accepted, the required attribution will be published on the home and release pages:

> Free code signing provided by SignPath.io, certificate by SignPath Foundation

That sentence describes the intended attribution after approval, not a present sponsorship claim. Eligibility and acceptance are determined by [SignPath Foundation](https://signpath.org/terms.html).

See [Privacy](PRIVACY.md). Signed release acceptance must include signature checks and real installation, upgrade and uninstallation tests; compilation alone does not establish a release pass.

The development-build evidence workflow does not request signing or publish a release. Its signature gate also requires `NOTE_EXPECTED_SIGNER_SUBJECT`, configured only after independently verifying the approved provider certificate's exact subject. An unconfigured or mismatched signer fails the check. Even a successful signature check does not establish provider approval, correct embedded-uninstaller provenance or native release acceptance.

## Prepared NSIS signing path — positive signing acceptance pending

The installer exporter supports `--export-uninstaller desktop/releases/signing/Uninstall.exe`. After provider approval, the application executable and that exported uninstaller must be signed from the same hosted source build; preserve upstream dependency signatures. The current development workflow only exports unsigned inputs and does not call a signing service.

To compile using those signed inputs, the Windows-only command is:

```sh
node desktop/scripts/windows-installer.mjs --signed-uninstaller desktop/releases/signing/Uninstall.exe --expected-publisher "EXACT SUBJECT OF THE INDEPENDENTLY VERIFIED APPROVED CERTIFICATE"
```

This command requires PowerShell 7 (`NOTE_POWERSHELL_EXE` can select its executable). It rejects unsigned inputs, an unexpected publisher, a missing timestamp, or a product/version mismatch. During `!uninstfinalize`, it snapshots and rechecks the signed uninstaller, compares it against this compilation's generated uninstaller including the NSIS overlay, and supplies only those verified bytes back to NSIS. Differences are restricted to Authenticode checksum/security-directory fields, at most seven zero alignment bytes, and one certificate record at the end. Changed executable or uninstall payload bytes fail compilation. A per-build nonce ties the proof to the current invocation.

The resulting setup executable still requires its own provider signature. The hook proof establishes the compiler input, not extraction or installation acceptance. This positive path has not yet been exercised with our own trusted signed files; provider activation and signed installation/upgrade/uninstallation remain pending. Unknown signing switches fail instead of silently compiling an unsigned fallback.
