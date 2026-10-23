# Code signing policy

Status: unsigned preview. A SignPath Foundation application was submitted on 2026-10-23; the website confirmed submission. Approval and signing access remain pending. No existing binary is represented as signed by SignPath Foundation.

Proposed source maintainer, reviewer and signing approver: [ldohgfsdu](https://github.com/ldohgfsdu). The account owner has confirmed that GitHub two-factor authentication is enabled. SignPath account enrollment, its multi-factor authentication and signing-role configuration remain pending.

Release artifacts must be produced from the public source revision using a verifiable build pipeline. Each signing request requires manual maintainer approval. Application, installer and uninstaller signing must be handled explicitly; upstream dependencies retain their own identity and licenses.

If the project is accepted, the required attribution will be published on the home and release pages:

> Free code signing provided by SignPath.io, certificate by SignPath Foundation

That sentence describes the intended attribution after approval, not a present sponsorship claim. Eligibility and acceptance are determined by [SignPath Foundation](https://signpath.org/terms.html).

See [Privacy](PRIVACY.md). Signed release acceptance must include signature checks and real installation, upgrade and uninstallation tests; compilation alone does not establish a release pass.

The development-build evidence workflow does not request signing or publish a release. Its signature gate also requires `NOTE_EXPECTED_SIGNER_SUBJECT`, configured only after independently verifying the approved provider certificate's exact subject. An unconfigured or mismatched signer fails the check. Even a successful signature check does not establish provider approval, correct embedded-uninstaller provenance or native release acceptance.
