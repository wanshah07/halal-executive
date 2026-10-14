Run the Halal Executive 3-hourly pass.

1. `cd pipeline && python process_raw.py --source whatsapp,telegram` then `python drive_organiser.py`.
2. The script loops until the Raw queue for those sources is empty. Do not stop it early.
3. If it exits non-zero with "all providers failed", do nothing else; the batch stays `new`. Report which provider failed first and the error, in one line.
4. Otherwise report: messages processed, FAQ rows written, which provider answered (MIRELD or AFIQ) and whether a fallback happened.
Never edit the Sheet by hand from a Routine and never mark a row processed without a written FAQ/skip decision from the model.
