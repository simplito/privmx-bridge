# Access Control List

An Access Control List (ACL) is a set of **rules that determine which functions a user can access**.
It consists of simple instructions using the terms "**ALLOW**" or "**DENY**" followed by the name of a function or group.
By default, an ACL is set to "**DENY ALL**". Instructions are executed in the order they are listed.
If group scopes overlap, the second instruction will override the overlapping portion.

<div class="center-column"></div>

```
ALLOW store/READ
ALLOW store/storeFileCreate
ALLOW thread/ALL
DENY thread/deleteThread
DENY thread/deleteMessage
DENY thread/deleteManyMessages
DENY thread/deleteMessagesOlderThan
```

The example below allows the user to browse Stores, create files, and use Threads, but doesn't allow to delete Threads or messages:

A more detailed explanation and breakdown of the example:

<div class="center-column"></div>

```
ALLOW store/READ                     => Grants access to all methods in the store/READ group
ALLOW store/storeFileCreate          => Grants access to the storeFileCreate method
ALLOW thread/ALL                     => Grants access to all methods in the thread group
DENY thread/deleteThread             => Revokes access to the thread/deleteThread method, other thread methods remain unchanged
DENY thread/deleteMessage            => Revokes access to the thread/deleteMessage method, other thread methods remain unchanged
DENY thread/deleteManyMessages       => Revokes access to the thread/deleteManyMessages method, other thread methods remain unchanged
DENY thread/deleteMessagesOlderThan  => Revokes access to the thread/deleteMessagesOlderThan method, other thread methods remain unchanged
```

It's also possible to bind an ACL rule to a specific object by using function arguments:

<div class="center-column"></div>

```
[DIRECTIVE] [scope/method] [parameter]=[argument]
```

Example:

<div class="center-column"></div>

```
ALLOW store/storeFileWrite storeId=65ad8f6c2e4f4f1adb40bf81
```

Check all ACL groups <a href="#acl-groups-and-functions">here</a>.
