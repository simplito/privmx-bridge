# Query

## Overview
The Query field is a mechanism that enables logical operations and property-based queries on public metadata. You can filter data only by checking fields that are part of the public metadata. It narrows the returned list to include only items that match the specified query pattern.

## Examples

Given example public meta object: 

<div class="center-column"></div>

```typescript
{
    "status": string,
    "role": string,
    "score": number,
    "additionalInfo": {
        "category": string,
        "label": string
    }

}
```

### Basic Property Query
Find records where `status` is "active":

<div class="center-column"></div>

A simple equality check can be written in two ways:

<div class="center-column"></div>

```json
{
    "status": "active"
}
```

Its identical with

<div class="center-column"></div>

```json
{
    "status": {"$eq": "active"}
}
```

Find records where `score` is greater than 20:

<div class="center-column"></div>

```json
{
    "score": { "$gt": 20 }
}
```

### Multiple Conditions on a Single Field
You can apply multiple conditions to a single field:

<div class="center-column"></div>

```json
{
    "score": { "$gt": 20, "$lt": 35 }
}
```

### Accessing Nested Objects

You can query nested objects using `dot notation`, which allows you to reference properties inside embedded structures.

<div class="center-column"></div>

```json
{
    "additionalInfo.category": "finance",
}
```

### Multiple Conditions
To find records where score is greater than 20 and status is "active", you can write the query in two ways.

Implicit

<div class="center-column"></div>

```json
{
    "score": { "$gt": 20 },
    "status": "active"
}
```

Explicit AND using $and

<div class="center-column"></div>

```json
{
    "$and": [
        { "score": { "$gt": 20 } },
        { "status": "active" }
    ]
}
```

### Using `$or`
Find records where `status` is "active" or `role` is "member":

<div class="center-column"></div>

```json
{
    "$or": [
        { "status": "active"},
        { "role": "member"}
    ]
}
```
<br>

## Query Structure

### Query Values

Query values can be `Number`, `String`, `Boolean`, or `Null`. A query value cannot be an object or an array.

### Logical Operators

Parameter | Type | Description
--------- | ---- | -----------
`$and` | Array | An array of query objects that must all be satisfied.
`$or` | Array | An array of query objects where at least one must be satisfied.

### Query Properties

Parameter | Type | Description
--------- | ---- | -----------
`$gt` | Number | Greater than
`$gte` | Number | Greater than or equal to
`$lt` | Number | Less than
`$lte` | Number | Less than or equal to
`$exists` | Boolean | Property existence check
`$eq` | Query Value | Equals
`$ne` | Query Value | Not equals
`$in` | Array of Query Value | Matches any value in the array
`$startsWith` | String | Checks if the value starts with a given string
`$endsWith` | String | Checks if the value ends with a given string
`$contains` | String | Checks if the value contains a given substring
