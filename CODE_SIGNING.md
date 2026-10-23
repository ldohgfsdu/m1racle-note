# Code signing policy

Status: unsigned preview; SignPath Foundation application is planned and has not been approved. No existing binary is represented as signed by SignPath Foundation.

Proposed source maintainers, reviewers and signing approvers: [ldohgfsdu](https://github.com/ldohgfsdu). Actual account access, two-factor authentication and signing roles must be confirmed by the account owner before submitting an application.

Release artifacts must be produced from the public source revision using a verifiable build pipeline. Each signing request requires manual maintainer approval. Application, installer and uninstaller signing must be handled explicitly; upstream dependencies retain their own identity and licenses.

If the project is accepted, the required attribution will be published on the home and release pages:

> Free code signing provided by SignPath.io, certificate by SignPath Foundation

That sentence describes the intended attribution after approval, not a present sponsorship claim. Eligibility and acceptance are determined by [SignPath Foundation](https://signpath.org/terms.html).

See [Privacy](PRIVACY.md). Signed release acceptance must include signature checks and real installation, upgrade and uninstallation tests; compilation alone does not establish a release pass.
