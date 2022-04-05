# scheduler

Javascript/GLPK shift scheduling app.  Currently written strictly for one-employee-per-day shifts, and uses a straightforward integer optimization routine ([GLPK.js](https://github.com/jvail/glpk.js)) to create an "optimal" slate.  Optimal defined as:

- Minimize the difference between the person with the most shifts and person with the least shifts
- One employee per day
- Weight weekend duty higher (currently double) when tallying shifts
- Obey any requested exemptions
- Prevent any employee having more than one shift in a K-day period (K is user specified)
- Account for previous month's slate for total tally and K-day 1-shift constraint


## Working issues

Ongoing projects:

- Different weighting schemes
- Generate report with summary stats of optimal slate
- Allow export slate
- Allow import previous month
- About page
