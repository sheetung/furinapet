# Furina Blender Rig Guide v0.1

## Coordinate

- Y-up
- Z-forward
- 1 unit = 1 meter

## Skeleton principle

Bones control:
- pose
- direction
- IK targets
- body movement

Morph controls:
- expression
- mouth
- eyelids

## Recommended hierarchy

```
root
└── motion_root
    └── body
        └── spine
            └── chest
                └── neck
                    └── head
```

## Naming

Use:

```
snake_case
_left
_right
```

Avoid:

```
L
R
```

## Weight rules

- Maximum 4 bones per vertex
- Body uses spine/chest influence
- Hair uses dedicated bones + spring
- Accessories use rigid weights

## Export

Format:

```
glTF 2.0 binary (.glb)
```

Required:

```
furina.mesh.glb
furina.skeleton.json
furina.animations.json
```
