# Furina Art Production Plan v0.1

## Goal

Create a lightweight AI desktop pet asset: 2D visual style + 3D skeletal driving + real-time rendering.

The asset is optimized for interaction, expression and low latency, not cinematic animation.

## Pipeline

```
Concept art
  -> PSD layer separation
  -> Blender mesh preparation
  -> Skeleton rig
  -> Weight paint
  -> Morph expressions
  -> glTF export
  -> furinapet renderer
```

## Asset layers

```
body
head
face
eyes
hair
clothes
accessory
```

## Production stages

### M0 White Model

Deliver:
- mesh
- skeleton
- skin weights
- glTF loading test

### M1 Interactive Character

Add:
- lookAt
- blink
- basic expressions
- simple gestures

### M2 Final Asset

Add:
- refined textures
- accessories
- spring motion tuning

## Avoid

Do not create:
- finger bones
- toe bones
- individual hair strand bones
- complex cloth simulation

Use morph, spring and damping instead.

## Delivery

```
characters/furina/model/
  furina.mesh.glb
  furina.skeleton.json
  furina.animations.json

characters/furina/textures/
```
