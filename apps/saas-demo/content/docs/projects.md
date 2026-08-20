---
title: Projects
---

# Projects

A project groups a set of sensors, dashboards and API keys. Every project
belongs to exactly one owner, and only the owner can rename or delete it.

## Renaming a project

Open the project, then **Settings → General**. Names can be up to 60
characters. Renaming does not change the project id, so API integrations keep
working.

## Deleting a project

Deleting a project is permanent. Data, dashboards and API keys attached to the
project are removed and cannot be restored. Export anything you need first.

## Environments

Each project is either `production` or `staging`. Staging projects do not count
towards your plan's production project limit.
