---
title: FactPublicHoliday
category: entities
tags: [fact-table, calendar, worker-data-mart, entity]
summary: FactPublicHoliday is a gold-layer calendar fact table listing public holidays per office, used to exclude non-working days from forecast metrics.
sources: [synthetic-golden-vault]
aliases: [FactPublicHoliday, public holiday calendar]
---

# FactPublicHoliday

FactPublicHoliday lists public holidays per office and region. The
[[concepts/worker-data-mart]] joins this table against
[[entities/fact-person-forecast-history]] so that forecast utilisation
metrics exclude non-working days.

## Key Ideas

- The table is sourced from an annual vendor calendar feed, not from BigHand. ^[inferred]
- Missing holiday rows for a new office are a common cause of inflated utilisation figures. See [[skills/troubleshooting-failed-loads]].

## Related

- [[concepts/worker-data-mart]] - the mart that consumes this calendar
- [[entities/fact-person-forecast-history]] - the fact table joined against this calendar
