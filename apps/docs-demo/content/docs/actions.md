---
title: Actions and permissions
url: /docs/actions
---

# Actions and permissions

An action is a capability you explicitly expose. The model can only ever reach actions you
registered — it has no access to your database, your DOM, or the rest of your codebase.

## Permission levels

Every action declares one of three permissions. `auto` is for reads, queries and navigation.
`confirm` is for persistent writes, destructive operations, sending things, billing changes and
anything sensitive; it requires the user to click a button on a structured card. `disabled`
removes the action from the model's capability surface entirely, before it is ever described.

## Dynamic permissions

A permission can be a function of the user and the input. A resolver that throws, or returns
anything unexpected, fails closed to `disabled`.

## Permissions are not authorization

An `auto` decision only means the runtime may call your code. It says nothing about whether this
user may do this thing. Your own `execute()` must still check. Both demo applications
deliberately show this double check.

## Client and server actions

Server actions run inside your authenticated code. Client actions — navigation, opening a modal,
highlighting an element — run in the browser and never touch secrets.
