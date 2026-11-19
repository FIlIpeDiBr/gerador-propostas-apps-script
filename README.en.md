# Proposal Generator (Apps Script)

[![CI](https://github.com/FIlIpeDiBr/gerador-propostas-apps-script/actions/workflows/ci.yml/badge.svg)](https://github.com/FIlIpeDiBr/gerador-propostas-apps-script/actions/workflows/ci.yml)

A Google Apps Script web app that generates fee proposals. Staff fill in a form, the app prices the service from a table (tax regime, sector, revenue band, headcount) and returns a short link. The client opens the link, reads the proposal and accepts it with their name and CPF (Brazilian taxpayer id); the acceptance is recorded in a spreadsheet and staff are notified by e-mail.

It was built for a Brazilian accounting firm and is published here without the firm's identity: the name, contact details, copy and **every price** are examples. Code identifiers and interface text are in Portuguese.

*[Versão em português](README.md)*

## Engineering decisions

**Only two functions answer the browser.** In Apps Script, every global function without a trailing `_` can be called by any visitor. Here the form calls `gerarLinkProposta`, which requires the staff key, and the proposal calls `aceitarProposta`, which requires the proposal code. One test fails if another function becomes public; another checks that each page calls only its own.

**The generator does not open for someone who only holds a proposal link.** The form and the proposal share one deployment. Without the staff key in the URL, removing the code from the link leads to an access notice, not to the form.

**The link carries only a code.** The data stays in the spreadsheet, so there is nothing to tamper with in the URL. The code is 10 characters from a 32-symbol alphabet (50 bits), derived from a hash of UUIDs (`Math.random` is predictable), and leaves out `0/O` and `1/I`.

**Money in integer cents.** Floating-point sums go wrong in the last cent. The total is always the exact sum of the lines shown, and a test checks it with values chosen to break under `float`.

**One price table.** The form receives the table from the server when it opens, so the preview staff see and the proposal the client receives come from the same numbers.

**The server validates everything again.** `validarFormulario_` checks lengths, ranges, dates that exist, and CNPJ check digits, including the alphanumeric CNPJ in force for new registrations since July 2026.

**Validity is enforced.** A proposal is valid until its issue date plus the given number of days. Once expired it can still be read, but acceptance is refused. The comparison handles the cell both as text and as `Date`, because Sheets converts date-looking text on its own.

**Acceptance shows what actually happened.** The page displays "accepted" only after the server confirms the write. Acceptance re-reads the row inside a lock, so two clicks do not produce two records or two e-mails, and reopening the link shows the proposal in its current state.

**CPF: full in the spreadsheet, masked in the e-mail.**

## Running it

```bash
cp .clasp.json.example .clasp.json   # fill in your project's scriptId
clasp push
```

Then, in the Apps Script editor: run `inicializar` (it creates the spreadsheet and writes the staff key to the execution log), add the `EMAIL_ACEITE` script property, deploy as a web app, and open `URL?k=<key>`.

## Tests

```bash
npm test
```

42 tests on `node:test`, no dependencies. The `.gs` files are loaded into an isolated context with fakes for Sheets, properties, lock and mail, and a clock controlled by the test. They cover pricing (band edges, headcount extras, optional service, manual pricing, fixed plans), form validation, CPF and CNPJ, the generate → open → accept path, expiry, repeated acceptance, mail and spreadsheet failures, clean-up, and the public function list. Both pages are rendered with server data and their scripts compiled. CI runs the suite on Node 20 and 22.

## Known limitations

- There is a single staff key and it travels in the URL. No per-person users and no record of who generated each proposal.
- Acceptance is a record (name, CPF, date and time), not an electronic signature. The proposal says the definitive contract comes afterwards.
- The price table lives in code; changing a value needs a new deployment.
- The spreadsheet is the database and the code lookup reads a whole column. Fine for one firm's volume, not for thousands of proposals a day.
- Tests use fakes for Google services. Nothing runs against real Apps Script, and on the browser side only rendering and script compilation are tested.

## Author

Filipe Dias Brandão · [github.com/FIlIpeDiBr](https://github.com/FIlIpeDiBr)

Published as a portfolio piece. All rights reserved.
