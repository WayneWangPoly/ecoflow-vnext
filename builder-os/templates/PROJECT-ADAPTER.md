# Project Adapter Template

Project:
Domain:
External systems:
Primary users:
Risk class:

## Economic node

What recurring operational node is being controlled?
What flows through it?
Why is this node valuable?

## Authority map

| Fact | Authoritative writer | Read models/caches | External source | Mutation command |
|---|---|---|---|---|

## Actors and capabilities

| Actor | Read capabilities | Command capabilities | Approval boundaries |
|---|---|---|---|

## Objects / states / events

List stable object identities, state machines and durable events.

## Evidence contracts

For each important terminal or financial/physical state, define what evidence is required before it becomes authoritative.

## Data planes

Raw landing:
Operational core:
Read/projection:
Analytics/semantic:
Presentation/agent:

## Offline/device boundary

What can be journalled locally?
What cannot be shown as completed without server acknowledgement?
What device/browser fallbacks are required?

## Eval pack

Select applicable Builder OS evals and add domain-specific fixtures. Do not rewrite invariant oracles simply to fit the implementation.

## Readiness

Engineering:
Data:
Deployment:
Production:
Field:

## Project-specific exclusions from Builder OS

List customer data, proprietary policy and domain rules that must remain in the adapter/project layer.
