# Gemini Studio

A local web UI for the Gemini CLI: chats, reasoning steps, a built-in file browser and diff viewer, voice input.
It runs on your own machine (it only listens on `127.0.0.1`) and uses your own Gemini login and chat history.

## What you need

1. **Node.js 18 or newer** — https://nodejs.org
2. **The Gemini CLI, installed and signed in** — run `npm install -g @google/gemini-cli`, then run `gemini` once in a
   terminal and sign in with your Google account.
3. **Chrome or Edge** for the best experience (voice input only works there; the browser sends the audio to its
   speech service).

There is nothing to install for the app itself (no `npm install`).

## Start it

Windows: double-click **start.bat**.
Anywhere: in this folder run

```
node server.js
```

It opens http://localhost:4545 in your browser. Use another port with `node server.js 5000`, and add `--no-open` to
skip opening the browser. Press Ctrl+C in the terminal to stop it.

After updating the files, stop it and start it again (the page itself only needs a hard refresh, Ctrl+F5).

## Good to know

- New chats run Gemini in **auto-approve mode ("yolo")** by default: it can edit files and run commands in the folder
  you choose without asking. Switch modes with the pill under the message box, or Shift+Tab in the message box:
  Auto-approve → Auto-edit → Plan.
- **Plan mode** (also `/plan`, or `/plan <task>`): Gemini only reads and writes a plan; nothing is changed. The reply
  shows the plan with **Approve and build** (pick Auto-approve or Auto-edit for the build) and **Request changes**.
  Plans are kept in Gemini's temp folder (`~/.gemini/tmp`), which Windows may clean up over time.
- **Commands:** type `/` in the message box for a menu of commands (↑ ↓, Tab or Enter, Esc). App commands
  (`/new`, `/plan`, `/auto-approve`, `/auto-edit`, `/model`, `/directory add <path>`, `/files`, `/changes`,
  `/copy`, `/theme`, `/settings`, `/help`) run in the page; `/init` and your custom `.toml` commands (yours,
  the project's and your extensions') are sent to Gemini, which runs them.
- Chats are the Gemini CLI's own sessions (in `~/.gemini`), so they also show up in the `gemini` terminal, and the
  other way round.
- Uploaded attachments are copied to `~/.gemini-ui/uploads`.
- **Folder access:** the first chat in a folder asks whether Gemini may also use `~/.gemini/memory` and
  `~/.gemini/scratch` (when they exist). Allowed folders are added to its workspace for that project; change it in
  Settings → Folder access. Answers are kept in `~/.gemini-ui/folder-access.json`.
- On Windows the folder button and the attach button open the real Windows dialogs (elsewhere, the in-page picker).
- **Robot Framework** files (`.robot`, `.resource`) get syntax highlighting (also in diffs and in ```` ```robot ```` code blocks, light and dark)
  and the Robot Framework file icon from [vscode-icons](https://github.com/vscode-icons/vscode-icons) (CC BY-SA 4.0).
- If the Gemini CLI is installed somewhere unusual, set `GEMINI_JS` to the path of its `gemini.js`.

## Fonts

Google Sans Flex, Inter and JetBrains Mono are bundled in `public/fonts/` (SIL Open Font License 1.1), so the default look needs no network. Picking any other font in Settings -> Appearance loads it from Google Fonts.

## Security: no outside code

The page loads nothing from the internet. marked, DOMPurify, KaTeX and highlight.js are bundled in `public/vendor/` (unmodified copies from the official npm packages; `public/vendor/CHECKSUMS.json` has their versions and SHA-256 hashes), and the fonts are in `public/fonts/`. A Content-Security-Policy (in `index.html` and as a header from `server.js`) only allows scripts, styles, fonts, images and requests from this server, and the server only listens on 127.0.0.1. Scripts may only come from this server (no inline scripts). Pictures from the web in a reply are shown as links. To update a library, copy the new file from its npm package, run `npm audit` on it first and update the checksum.
