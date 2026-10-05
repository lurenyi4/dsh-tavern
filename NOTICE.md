# Sources and notices

This fork preserves DSH Tavern's GNU Affero General Public License v3.0 in LICENSE. Recovered baseline source identifies upstream https://github.com/flizzywine/dsh-tavern at commit 403df2d1e4080e4846627a58572c6347e3eefc02. Original README and credits are retained in README_UPSTREAM.md. New Story Runtime modifications are distributed under the same root license unless a file has a specific retained notice. Non-commercial project intent does not replace or restrict third-party license grants.

## Runtime and copied sources

- DeepSeek Harness runtime: exact 0.1.5-rc.2 dependency lock in config/cli-runtime/package-lock.json. Packages are fetched from the official npm registry with lifecycle scripts disabled. Runtime binaries/node_modules are not committed.
- Risu legacy module byte map: source, fixed commit/blob, and licensing attribution are retained at the top of world-runtime/src/import-risu.mjs and world-runtime/docs/IMPORT_WORK_LOG.md.
- ST-Prompt-Template vendored source and artifacts: tavern-plugin/lib/vendor/st-prompt-template/README.md, upstream/LICENSE, and adjacent artifact *.LICENSE.txt files. Those notices must travel with the files.
- MagVarUpdate, SillyTavern macros, and runtime UI assets retain their own README/LICENSE and artifact notices under tavern-plugin/lib/vendor/. Root license is not a substitute for their component notices.
- Android adapter, packaged sidebar/skin/image modules and config/plugin-web.LICENSE retain their local license files.
- The three named external plugin projects are behavior references; this work does not import JS-Slash-Runner's PolyForm Noncommercial code or relicense it as AGPL.

See world-runtime/docs/DEPENDENCY_INVENTORY.json for exact locked runtime versions/integrities and declared package licenses. NOASSERTION means the lock did not declare a license; consult that package's actual notice. The inventory is not a legal opinion or a claim that all licenses were independently audited.

## Distribution boundary

Do not publish user world databases, card collections, API keys, environment files, node_modules, raw user attachments, local runtime caches, or private request snapshots. New tests use synthetic story data and local mock endpoints. Source publishing does not authorize Pages deployment, a Release, or upstream writes. Automatic inherited deployment/manifest triggers are disabled in this fork.
