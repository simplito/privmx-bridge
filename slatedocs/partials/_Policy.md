
# Policy

Policies determine who is allowed to perform specific actions.
You can define your policy on three levels: for a Context, for a Container (Thread, Store, etc), and for items such as messages or files (not every Container has items, however).
Setting a policy in the Container overwrites the policy from the Context.
The property of the policy can be set to one of the following values:

- "default" - takes the default value, listed in PrivMX Bridge API
- "inherit" - always takes value from the Context (can only be used in Container and item policies)
- "none" - no one can perform this action
- "all" - all Context users can perform this action
- "user" - all Container users can perform this action
- "manager" - all Container managers can perform this action
- "owner" - only Container owner can perform this action
- "itemOwner" - only item owner can perform this action (can only be used in the item policy)

Leaving an empty policy in a Container or item policy results in `inherit`. In Context it results in `default`.

You can also combine the values listed above. If you want to allow item updates to be executed only by the item owner, with the additional assumption that they must be an active user of the Container, you can write `itemOwner&user`. But if you want to allow the Container managers to also update the item, you can write `itemOwner&user,manager`. In the policy entry, the `&` character means 'and', and the coma `,` means `or`. Operations with `&` are always performed first.

> Default policy:

```
{
  "context": {
    "listUsers": "all",
    "sendCustomNotification": "all"
  },
  "thread": {
    "get": "user",
    "listMy": "all",
    "listAll": "none",
    "create": "all",
    "update": "manager",
    "delete": "manager",
    "updatePolicy": "manager",
    "creatorHasToBeManager": "yes",
    "updaterCanBeRemovedFromManagers": "no",
    "ownerCanBeRemovedFromManagers": "yes",
    "canOverwriteContextPolicy": "yes",
    "sendCustomNotification": "all",
    "item": {
      "get": "user",
      "listMy": "user",
      "listAll": "user",
      "create": "user",
      "update": "itemOwner&user,manager",
      "delete": "itemOwner&user,manager"
    }
  },
  "store": {
    "get": "user",
    "listMy": "all",
    "listAll": "none",
    "create": "all",
    "update": "manager",
    "delete": "manager",
    "updatePolicy": "manager",
    "creatorHasToBeManager": "yes",
    "updaterCanBeRemovedFromManagers": "no",
    "ownerCanBeRemovedFromManagers": "yes",
    "canOverwriteContextPolicy": "yes",
    "sendCustomNotification": "all",
    "item": {
      "get": "user",
      "listMy": "user",
      "listAll": "user",
      "create": "user",
      "update": "itemOwner&user,manager",
      "delete": "itemOwner&user,manager"
    }
  },
  "inbox": {
    "get": "user",
    "listMy": "all",
    "listAll": "none",
    "create": "all",
    "update": "manager",
    "delete": "manager",
    "updatePolicy": "manager",
    "creatorHasToBeManager": "yes",
    "updaterCanBeRemovedFromManagers": "no",
    "ownerCanBeRemovedFromManagers": "yes",
    "canOverwriteContextPolicy": "yes",
    "sendCustomNotification": "all"
  },
  "stream": {
    "get": "user",
    "listMy": "all",
    "listAll": "none",
    "create": "all",
    "update": "manager",
    "delete": "manager",
    "updatePolicy": "manager",
    "creatorHasToBeManager": "yes",
    "updaterCanBeRemovedFromManagers": "no",
    "ownerCanBeRemovedFromManagers": "yes",
    "canOverwriteContextPolicy": "yes",
    "sendCustomNotification": "all"
  }
}
```

Parameter | Allowed Values | Description
--------- | -------------- | -----------
context |  | *(optional)* Policy for container unrelated actions in this context
&nbsp;&nbsp;›&nbsp;&nbsp;listUsers | default<br>none<br>all | *(optional)* Determines who can list users of this context
&nbsp;&nbsp;›&nbsp;&nbsp;sendCustomNotification | default<br>none<br>all | *(optional)* Determines who can send custom notifications
thread |  | *(optional)* Policy for threads in this context
&nbsp;&nbsp;›&nbsp;&nbsp;item |  | *(optional)* Item policy
&nbsp;&nbsp;›&nbsp;&nbsp;&nbsp;&nbsp;›&nbsp;&nbsp;get | user<br>itemOwner<br>manager<br>owner | *(optional)* Determines who can get an item
&nbsp;&nbsp;›&nbsp;&nbsp;&nbsp;&nbsp;›&nbsp;&nbsp;listMy | user<br>manager<br>owner| *(optional)* Determines who can list items created by themselves
&nbsp;&nbsp;›&nbsp;&nbsp;&nbsp;&nbsp;›&nbsp;&nbsp;listAll | user<br>manager<br>owner| *(optional)* Determines who can list all items
&nbsp;&nbsp;›&nbsp;&nbsp;&nbsp;&nbsp;›&nbsp;&nbsp;create | user<br>manager<br>owner| *(optional)* Determines who can create an item
&nbsp;&nbsp;›&nbsp;&nbsp;&nbsp;&nbsp;›&nbsp;&nbsp;update | user<br>itemOwner<br>manager<br>owner| *(optional)* Determines who can update an item
&nbsp;&nbsp;›&nbsp;&nbsp;&nbsp;&nbsp;›&nbsp;&nbsp;delete | user<br>itemOwner<br>manager<br>owner| *(optional)* Determines who can update an item
&nbsp;&nbsp;›&nbsp;&nbsp;get |  default<br>none<br>all<br>user<br>manager<br>owner | *(optional)* Determines who can get a container
&nbsp;&nbsp;›&nbsp;&nbsp;listMy | default<br>none<br>all | *(optional)* Determines who can list Containers you have access to as a user or manager.
&nbsp;&nbsp;›&nbsp;&nbsp;listAll | default<br>none<br>all | *(optional)* Determines who can list all containers
&nbsp;&nbsp;›&nbsp;&nbsp;create | default<br>none<br>all | *(optional)* Determines who can create a container
&nbsp;&nbsp;›&nbsp;&nbsp;update |  default<br>none<br>all<br>user<br>manager<br>owner | *(optional)* Determines who can update a container
&nbsp;&nbsp;›&nbsp;&nbsp;delete |  default<br>none<br>all<br>user<br>manager<br>owner | *(optional)* Determines who can update a container
&nbsp;&nbsp;›&nbsp;&nbsp;updatePolicy |  default<br>none<br>all<br>user<br>manager<br>owner | *(optional)* Determines who can update policy
&nbsp;&nbsp;›&nbsp;&nbsp;creatorHasToBeManager | default<br>inherit<br>yes<br>no | *(optional)* Determines whether the creator has to be added to the list of managers
&nbsp;&nbsp;›&nbsp;&nbsp;updaterCanBeRemovedFromManagers | default<br>inherit<br>yes<br>no | *(optional)* Determines whether the updater can be removed from the list of managers
&nbsp;&nbsp;›&nbsp;&nbsp;ownerCanBeRemovedFromManagers | default<br>inherit<br>yes<br>no | *(optional)* Determines whether the owner can be removed from the list of managers
&nbsp;&nbsp;›&nbsp;&nbsp;canOverwriteContextPolicy | default<br>inherit<br>yes<br>no | *(optional)* Determines whether the policy can be overwritten in container
&nbsp;&nbsp;›&nbsp;&nbsp;sendCustomNotification | default<br>none<br>all | *(optional)* Determines who can send custom notifications
store |  | *(optional)* Policy for stores in this context
&nbsp;&nbsp;›&nbsp;&nbsp;item |  | *(optional)* Item policy
&nbsp;&nbsp;›&nbsp;&nbsp;&nbsp;&nbsp;›&nbsp;&nbsp;get | user<br>itemOwner<br>manager<br>owner| *(optional)* Determines who can get an item
&nbsp;&nbsp;›&nbsp;&nbsp;&nbsp;&nbsp;›&nbsp;&nbsp;listMy | user<br>manager<br>owner| *(optional)* Determines who can list items created by themselves
&nbsp;&nbsp;›&nbsp;&nbsp;&nbsp;&nbsp;›&nbsp;&nbsp;listAll | user<br>manager<br>owner| *(optional)* Determines who can list all items
&nbsp;&nbsp;›&nbsp;&nbsp;&nbsp;&nbsp;›&nbsp;&nbsp;create | user<br>manager<br>owner| *(optional)* Determines who can create an item
&nbsp;&nbsp;›&nbsp;&nbsp;&nbsp;&nbsp;›&nbsp;&nbsp;update | user<br>itemOwner<br>manager<br>owner| *(optional)* Determines who can update an item
&nbsp;&nbsp;›&nbsp;&nbsp;&nbsp;&nbsp;›&nbsp;&nbsp;delete | user<br>itemOwner<br>manager<br>owner| *(optional)* Determines who can update an item
&nbsp;&nbsp;›&nbsp;&nbsp;get |  default<br>none<br>all<br>user<br>manager<br>owner | *(optional)* Determines who can get a container
&nbsp;&nbsp;›&nbsp;&nbsp;listMy | default<br>none<br>all | *(optional)* Determines who can list containers created by themselves
&nbsp;&nbsp;›&nbsp;&nbsp;listAll | default<br>none<br>all | *(optional)* Determines who can list all containers
&nbsp;&nbsp;›&nbsp;&nbsp;create | default<br>none<br>all | *(optional)* Determines who can create a container
&nbsp;&nbsp;›&nbsp;&nbsp;update | default<br>none<br>all<br>user<br>manager<br>owner  | *(optional)* Determines who can update a container
&nbsp;&nbsp;›&nbsp;&nbsp;delete |  default<br>none<br>all<br>user<br>manager<br>owner | *(optional)* Determines who can update a container
&nbsp;&nbsp;›&nbsp;&nbsp;updatePolicy | default<br>none<br>all<br>user<br>manager<br>owner  | *(optional)* Determines who can update policy
&nbsp;&nbsp;›&nbsp;&nbsp;creatorHasToBeManager | default<br>inherit<br>yes<br>no | *(optional)* Determines whether the creator has to be added to the list of managers
&nbsp;&nbsp;›&nbsp;&nbsp;updaterCanBeRemovedFromManagers | default<br>inherit<br>yes<br>no | *(optional)* Determines whether the updater can be removed from the list of managers
&nbsp;&nbsp;›&nbsp;&nbsp;ownerCanBeRemovedFromManagers | default<br>inherit<br>yes<br>no | *(optional)* Determines whether the owner can be removed from the list of managers
&nbsp;&nbsp;›&nbsp;&nbsp;canOverwriteContextPolicy | default<br>inherit<br>yes<br>no | *(optional)* Determines whether the policy can be overwritten in container
&nbsp;&nbsp;›&nbsp;&nbsp;sendCustomNotification | default<br>none<br>all | *(optional)* Determines who can send custom notifications
inbox |  | *(optional)* Policy for inboxes in this context
&nbsp;&nbsp;›&nbsp;&nbsp;get | default<br>none<br>all<br>user<br>manager<br>owner  | *(optional)* Determines who can get a container
&nbsp;&nbsp;›&nbsp;&nbsp;listMy | default<br>none<br>all | *(optional)* Determines who can list containers created by themselves
&nbsp;&nbsp;›&nbsp;&nbsp;listAll | default<br>none<br>all | *(optional)* Determines who can list all containers
&nbsp;&nbsp;›&nbsp;&nbsp;create | default<br>none<br>all | *(optional)* Determines who can create a container
&nbsp;&nbsp;›&nbsp;&nbsp;update | default<br>none<br>all<br>user<br>manager<br>owner  | *(optional)* Determines who can update a container
&nbsp;&nbsp;›&nbsp;&nbsp;delete | default<br>none<br>all<br>user<br>manager<br>owner  | *(optional)* Determines who can update a container
&nbsp;&nbsp;›&nbsp;&nbsp;updatePolicy | default<br>none<br>all<br>user<br>manager<br>owner  | *(optional)* Determines who can update policy
&nbsp;&nbsp;›&nbsp;&nbsp;creatorHasToBeManager | default<br>inherit<br>yes<br>no | *(optional)* Determines whether the creator has to be added to the list of managers
&nbsp;&nbsp;›&nbsp;&nbsp;updaterCanBeRemovedFromManagers | default<br>inherit<br>yes<br>no | *(optional)* Determines whether the updater can be removed from the list of managers
&nbsp;&nbsp;›&nbsp;&nbsp;ownerCanBeRemovedFromManagers | default<br>inherit<br>yes<br>no | *(optional)* Determines whether the owner can be removed from the list of managers
&nbsp;&nbsp;›&nbsp;&nbsp;canOverwriteContextPolicy | default<br>inherit<br>yes<br>no | *(optional)* Determines whether the policy can be overwritten in container
&nbsp;&nbsp;›&nbsp;&nbsp;sendCustomNotification | default<br>none<br>all | *(optional)* Determines who can send custom notifications
stream |  | *(optional)* Policy for streams in this context
&nbsp;&nbsp;›&nbsp;&nbsp;get | default<br>none<br>all<br>user<br>manager<br>owner  | *(optional)* Determines who can get a container
&nbsp;&nbsp;›&nbsp;&nbsp;listMy | default<br>none<br>all | *(optional)* Determines who can list containers created by themselves
&nbsp;&nbsp;›&nbsp;&nbsp;listAll | default<br>none<br>all | *(optional)* Determines who can list all containers
&nbsp;&nbsp;›&nbsp;&nbsp;create | default<br>none<br>all | *(optional)* Determines who can create a container
&nbsp;&nbsp;›&nbsp;&nbsp;update | default<br>none<br>all<br>user<br>manager<br>owner  | *(optional)* Determines who can update a container
&nbsp;&nbsp;›&nbsp;&nbsp;delete | default<br>none<br>all<br>user<br>manager<br>owner  | *(optional)* Determines who can update a container
&nbsp;&nbsp;›&nbsp;&nbsp;updatePolicy | default<br>none<br>all<br>user<br>manager<br>owner  | *(optional)* Determines who can update policy
&nbsp;&nbsp;›&nbsp;&nbsp;creatorHasToBeManager | default<br>inherit<br>yes<br>no | *(optional)* Determines whether the creator has to be added to the list of managers
&nbsp;&nbsp;›&nbsp;&nbsp;updaterCanBeRemovedFromManagers | default<br>inherit<br>yes<br>no | *(optional)* Determines whether the updater can be removed from the list of managers
&nbsp;&nbsp;›&nbsp;&nbsp;ownerCanBeRemovedFromManagers | default<br>inherit<br>yes<br>no | *(optional)* Determines whether the owner can be removed from the list of managers
&nbsp;&nbsp;›&nbsp;&nbsp;canOverwriteContextPolicy | default<br>inherit<br>yes<br>no | *(optional)* Determines whether the policy can be overwritten in container
&nbsp;&nbsp;›&nbsp;&nbsp;sendCustomNotification | default<br>none<br>all | *(optional)* Determines who can send custom notifications 
