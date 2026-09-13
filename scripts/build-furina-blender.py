"""Build an editable, skinned 2.5D Furina asset from registered source cutouts.

Run with Blender --background --python this_file. This builds geometry, weights
and animation; it does not generate or modify raster artwork.
"""
import bpy
import json
import math
import struct
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'characters/furina/model'
QA = OUT / 'qa' / 'refined'
QA.mkdir(exist_ok=True, parents=True)
manifest = json.loads((OUT / 'furina.puppet.json').read_text(encoding='utf-8'))
SCALE = 0.0015

def point(x, y, depth=0):
    return ((x - 512) * SCALE, depth, (1443 - y) * SCALE)

# Pivots are registered in the source image, not fitted independently per part.
PIVOTS = {
    'root': (None, 512, 1443),
    'motion_root': ('root', 512, 1443),
    'body': ('motion_root', 512, 995),
    'spine': ('body', 512, 860),
    'chest': ('spine', 512, 730),
    'neck': ('chest', 512, 650),
    'head': ('neck', 512, 625),
    'face': ('head', 512, 560),
    'eye_left': ('face', 445, 525),
    'eye_right': ('face', 595, 525),
    'hair_back': ('head', 512, 580),
    'arm_left': ('chest', 399, 720),
    'arm_hand_left': ('arm_left', 260, 935),
    'arm_right': ('chest', 625, 720),
    'arm_hand_right': ('arm_right', 764, 935),
    'leg_left': ('body', 445, 1030),
    'leg_right': ('body', 585, 1030),
    'knee_left': ('leg_left', 445, 1195),
    'knee_right': ('leg_right', 585, 1195),
    'coat_left': ('body', 400, 935),
    'coat_right': ('body', 624, 935),
}

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
armature = bpy.data.armatures.new('FurinaArmature')
rig = bpy.data.objects.new('FurinaRig', armature)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name, (parent, x, y) in PIVOTS.items():
    bone = armature.edit_bones.new(name)
    bone.head = point(x, y)
    bone.tail = point(x, y - 45)
    if parent:
        bone.parent = armature.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
rig.show_in_front = True

depths = {'hair_back': 0.025, 'coat_left': 0.02, 'coat_right': 0.022,
          'leg_left': 0.009, 'leg_right': 0.013, 'body': 0,
          'arm_left': -0.008, 'arm_right': -0.008, 'head': -0.02}
objects = {}
for name, info in manifest['pieces'].items():
    texture_file = name+'-repaired.png' if name in ('arm_left', 'arm_right') else info['file']
    image = bpy.data.images.load(str(OUT / 'textures' / texture_file), check_existing=True)
    image.pack()
    width, height = info['textureSize']
    x0, y0, x1, y1 = info['sourceBounds']
    pad_x, pad_y = (width - (x1-x0))/2, (height - (y1-y0))/2
    left, top = x0-pad_x, y0-pad_y
    # Regular source-space topology allows smooth multi-bone deformation.
    spacing = 14 if name == 'head' else (12 if name.startswith('coat_') else 24)
    nx, ny = max(4, round(width/spacing)), max(4, round(height/spacing))
    verts, faces, uvs = [], [], []
    for j in range(ny+1):
        for i in range(nx+1):
            u, v = i/nx, j/ny
            verts.append(point(left+u*width, top+v*height, depths[name]))
            uvs.append((u, 1-v))
    for j in range(ny):
        for i in range(nx):
            a = j*(nx+1)+i
            # Trim sleeve islands accidentally present in the coat cutouts.
            # This edits mesh coverage only; the original texture is preserved.
            sx, sy = left+(i+.5)/nx*width, top+(j+.5)/ny*height
            edge = 609+.83*(sy-829)
            if sy < 1000 and ((name == 'coat_right' and sx > edge) or
                              (name == 'coat_left' and sx < 1024-edge)):
                continue
            faces.append((a, a+nx+1, a+nx+2, a+1))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    uv_layer = mesh.uv_layers.new(name='UVMap')
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            uv_layer.data[loop_index].uv = uvs[mesh.loops[loop_index].vertex_index]
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    objects[name] = obj
    mat = bpy.data.materials.new('Material_'+name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    shader = nodes.new('ShaderNodeBsdfPrincipled')
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = image
    links = mat.node_tree.links
    links.new(tex.outputs['Color'], shader.inputs['Base Color'])
    links.new(tex.outputs['Color'], shader.inputs['Emission Color'])
    shader.inputs['Emission Strength'].default_value = 1
    shader.inputs['Roughness'].default_value = 1
    links.new(tex.outputs['Alpha'], shader.inputs['Alpha'])
    links.new(shader.outputs['BSDF'], output.inputs['Surface'])
    mat.surface_render_method = 'DITHERED'
    obj.data.materials.append(mat)
    groups = {bone: obj.vertex_groups.new(name=bone) for bone in PIVOTS}
    for idx, vertex in enumerate(verts):
        source_y = 1443 - vertex[2]/SCALE
        weights = {name: 1.0}
        if name == 'body':
            t = min(1, max(0, (995-source_y)/265))
            weights = {'body': 1-t, 'chest': t}
        elif name.startswith('arm_'):
            hand = name.replace('arm_', 'arm_hand_')
            t = min(1, max(0, (source_y-850)/100))
            weights = {name: 1-t, hand: t}
        elif name.startswith('leg_'):
            knee = name.replace('leg_', 'knee_')
            t = min(1, max(0, (source_y-1145)/100))
            weights = {name: 1-t, knee: t}
        for bone, weight in weights.items():
            if weight > 0:
                groups[bone].add([idx], weight, 'REPLACE')
    modifier = obj.modifiers.new('Skin', 'ARMATURE')
    modifier.object = rig
    # Keep skinned meshes at scene root. Skin matrices handle bone motion;
    # parenting meshes to the armature triggers glTF non-root skin warnings.

# Replace ONLY the eye recesses with the generated skin underlay. The generated
# image has an opaque checkerboard outside the head: never use it for silhouette.
# Original head geometry, hair and hat keep the original RGBA texture.
head = objects['head']
underlay = head.data.materials[0].copy()
underlay.name = 'FaceUnderlay'
underlay_image = bpy.data.images.load(str(OUT/'textures/face-underlay-study.png'))
underlay_image.pack()
for node in underlay.node_tree.nodes:
    if node.type == 'TEX_IMAGE':
        node.image = underlay_image
head.data.materials.append(underlay)
for poly in head.data.polygons:
    x, y = poly.center.x/SCALE+512, 1443-poly.center.z/SCALE
    if 475 < y < 573 and (383 < x < 488 or 550 < x < 661):
        poly.material_index = 1

# Independent source-UV eye patches. Closed eyes reveal the skin beneath;
# the fringe never participates in their shape keys.
eye_polygons = {
    'eye_left': [(386,501),(397,492),(401,478),(420,488),(446,489),
                 (469,500),(481,519),(471,546),(458,564),(431,567),(409,557),(397,537)],
    'eye_right': [(555,507),(571,492),(594,488),(620,487),(634,477),
                  (639,491),(656,504),(644,537),(626,558),(600,567),(579,559),(565,542)],
}
eye_objects = []
for name, outline in eye_polygons.items():
    cx, cy = PIVOTS[name][1], 528
    coordinates = [(cx, cy)] + outline
    mesh = bpy.data.meshes.new(name+'_surface')
    mesh.from_pydata([point(x,y,-.023) for x,y in coordinates], [],
                    [(0, i+1, (i+1)%len(outline)+1) for i in range(len(outline))])
    mesh.update()
    uv = mesh.uv_layers.new()
    for loop in mesh.loops:
        x,y = coordinates[loop.vertex_index]
        uv.data[loop.index].uv = ((x-209)/644, 1-(y-26)/702)
    obj = bpy.data.objects.new(name+'_surface', mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(head.data.materials[0])
    group = obj.vertex_groups.new(name=name)
    group.add(list(range(len(coordinates))),1,'REPLACE')
    modifier = obj.modifiers.new('Skin', 'ARMATURE')
    modifier.object = rig
    objects[obj.name] = obj
    eye_objects.append(obj)

# Modelled eyelid strokes stay behind the face until blink brings them forward.
# These are editable mesh surfaces, not bitmap stand-ins or texture repainting.
lid_objects = []
lid_material = bpy.data.materials.new('EyelidInk')
lid_material.use_nodes = True
lid_shader = next(n for n in lid_material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
lid_shader.inputs['Base Color'].default_value = (.018,.012,.025,1)
lid_shader.inputs['Emission Color'].default_value = (.018,.012,.025,1)
lid_shader.inputs['Emission Strength'].default_value = 1
for name in eye_polygons:
    cx = PIVOTS[name][1]
    vertices, faces = [], []
    for i in range(17):
        dx = -46+92*i/16
        y = 526+.003*dx*dx
        for side in (-1,1):
            vertices.append(point(cx+dx,y+side*1.7,-.018))
    for i in range(16):
        faces.append((2*i,2*i+1,2*i+3,2*i+2))
    mesh = bpy.data.meshes.new(name+'_lid')
    mesh.from_pydata(vertices,[],faces)
    mesh.update()
    obj = bpy.data.objects.new(name+'_lid',mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(lid_material)
    group=obj.vertex_groups.new(name=name)
    group.add(list(range(len(vertices))),1,'REPLACE')
    obj.modifiers.new('Skin','ARMATURE').object=rig
    obj.shape_key_add(name='Basis',from_mix=False)
    for expression in ['happy','surprised','annoyed','tired','blink']:
        key=obj.shape_key_add(name=expression,from_mix=False)
        key.value=0
        if expression=='blink':
            for vertex in key.data:
                vertex.co.y=-.026
    objects[obj.name]=obj
    lid_objects.append(obj)

# UV-preserving facial deformation studies. No repainting of the source atlas.
# Neutral is Basis; expression weights should be cross-faded, not added together.
head.shape_key_add(name='Basis', from_mix=False)
expressions = ['happy', 'surprised', 'annoyed', 'tired', 'blink']
def smooth_window(value, inner, outer):
    t = min(1.0, max(0.0, (abs(value)-inner)/(outer-inner)))
    return 1-t*t*(3-2*t)

for expression in expressions:
    key = head.shape_key_add(name=expression, from_mix=False)
    key.value = 0
    for vertex, shaped in zip(head.data.vertices, key.data):
        x, y = vertex.co.x/SCALE+512, 1443-vertex.co.z/SCALE
        delta_y = 0.0
        mouth = smooth_window(x-517, 16, 35)*smooth_window(y-593, 8, 24)
        if expression == 'happy':
            delta_y += (3-abs(x-517)*.25)*mouth
        elif expression in ('annoyed', 'tired'):
            delta_y -= 3*mouth
        shaped.co.z -= delta_y*SCALE

for obj in eye_objects:
    obj.shape_key_add(name='Basis', from_mix=False)
    cx = 445 if obj.name.startswith('eye_left') else 595
    for expression in expressions:
        key = obj.shape_key_add(name=expression, from_mix=False)
        key.value = 0
        height = {'happy': .70, 'surprised': 1.10, 'annoyed': .58,
                  'tired': .42, 'blink': .035}[expression]
        for vertex, shaped in zip(obj.data.vertices, key.data):
            x,y = vertex.co.x/SCALE+512, 1443-vertex.co.z/SCALE
            target_y = 528+(y-528)*height
            if expression == 'happy':
                target_y += .003*(x-cx)**2-4
            if expression == 'annoyed':
                target_y += (x-cx)*(.15 if cx == 445 else -.15)
            shaped.co.z = (1443-target_y)*SCALE

for frame, value in [(1, 0), (5, 0), (8, 1), (10, 1), (14, 0), (30, 0)]:
    head.data.shape_keys.key_blocks['blink'].value = value
    head.data.shape_keys.key_blocks['blink'].keyframe_insert('value', frame=frame)
head.data.shape_keys.animation_data.action.name = 'blink'
head.data.shape_keys.animation_data.action.use_fake_user = True
for obj in eye_objects+lid_objects:
    for frame, value in [(1,0),(5,0),(8,1),(10,1),(14,0),(30,0)]:
        key = obj.data.shape_keys.key_blocks['blink']
        key.value = value
        key.keyframe_insert('value',frame=frame)
    # The GLB post-export step merges these independent weight channels.
    data = obj.data.shape_keys.animation_data
    data.action.name = 'blink_'+obj.name
    data.action.use_fake_user = True

scene = bpy.context.scene
scene.render.fps = 30
scene.frame_start = 1
scene.frame_end = 61
clips = {
    'idle': [(1, {}), (31, {'chest': 0.012, 'head': -0.012, 'coat_left': 0.025, 'coat_right': -0.025}), (61, {})],
    'wave': [(1, {}), (10, {'arm_right': 1.0}), (18, {'arm_right': 0.8, 'arm_hand_right': 0.25}), (26, {'arm_right': 1.0, 'arm_hand_right': -0.15}), (40, {})],
    'recoil': [(1, {}), (6, {'motion_root': -0.05, 'chest': -0.08, 'head': 0.07}), (14, {'chest': 0.025}), (25, {})],
    'walk': [(f, {
        'leg_left': .16*math.sin((f-1)*math.pi/15),
        'leg_right': -.16*math.sin((f-1)*math.pi/15),
        'knee_left': -.16*max(0,math.sin((f-1)*math.pi/15)),
        'knee_right': -.16*max(0,-math.sin((f-1)*math.pi/15)),
        'arm_left': -.10*math.sin((f-1)*math.pi/15),
        'arm_right': .10*math.sin((f-1)*math.pi/15),
        'hair_back': .025*math.sin((f-1)*math.pi/15),
        'coat_left': .04*math.sin((f-1)*math.pi/15),
        'coat_right': -.04*math.sin((f-1)*math.pi/15),
    }) for f in range(1,32)],
    'jump': [(1, {}), (7, {'leg_left': .12, 'leg_right': -.12, 'knee_left': -.18, 'knee_right': .18, 'chest': .025}),
             (14, {'arm_left': -.3, 'arm_right': .3, 'leg_left': -.08, 'leg_right': .08, 'coat_left': -.06, 'coat_right': .06}),
             (23, {'knee_left': -.12, 'knee_right': .12}), (31, {})],
    'cheer': [(1, {}), (10, {'arm_left': -.7, 'arm_right': .7, 'arm_hand_left': -.12, 'arm_hand_right': .12}),
              (20, {'arm_left': -.6, 'arm_right': .6, 'head': .03}), (31, {})],
    'think': [(1, {}), (16, {'head': .045, 'arm_right': .35, 'arm_hand_right': .3}), (46, {'head': .035, 'arm_right': .35, 'arm_hand_right': .3}), (61, {})],
}
for clip_name, keys in clips.items():
    rig.animation_data_clear()
    for frame, rotations in keys:
        for pose_bone in rig.pose.bones:
            pose_bone.rotation_mode = 'XYZ'
            # Bone local Y follows its length (world Z); local Z is the
            # image-plane normal. Rotating local Y would squash the cutout.
            pose_bone.rotation_euler = (0, 0, rotations.get(pose_bone.name, 0))
            pose_bone.keyframe_insert('rotation_euler', frame=frame, group=pose_bone.name)
            lift = 0
            if pose_bone.name == 'motion_root':
                if clip_name == 'walk': lift = .02*abs(math.sin((frame-1)*math.pi/15))
                if clip_name == 'jump': lift = {1:0, 7:-.025, 14:.10, 23:-.015, 31:0}[frame]
            pose_bone.location = (0, lift, 0)
            pose_bone.keyframe_insert('location', frame=frame, group=pose_bone.name)
    action = rig.animation_data.action
    action.name = clip_name
    action.use_fake_user = True
    track = rig.animation_data.nla_tracks.new()
    track.name = clip_name
    strip = track.strips.new(clip_name, 1, action)
    strip.action_frame_end = keys[-1][0]
    track.mute = True

rig.animation_data.action = bpy.data.actions.get('idle')
scene.frame_set(1)
bpy.ops.object.camera_add(location=(0, -6, 1.05))
camera = bpy.context.object
camera.name = 'PreviewCamera'
camera.rotation_euler = (Vector((0, 0, 1.05))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 2.4
scene.camera = camera
scene.render.engine = 'CYCLES'
scene.cycles.samples = 16
scene.render.resolution_x = 768
scene.render.resolution_y = 960
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.view_settings.view_transform = 'Standard'
scene.world.color = (0,0,0)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
for obj in objects.values():
    obj.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'furina.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'furina.skinned.glb'), export_format='GLB',
    use_selection=True, export_animations=True, export_animation_mode='ACTIONS',
    export_skins=True, export_yup=True)
# Blender ACTIONS exports per-object morph actions separately. Consolidate the
# disjoint weight channels into one blink clip without modifying binary data.
glb_path = OUT/'furina.skinned.glb'
payload = glb_path.read_bytes()
json_length = struct.unpack_from('<I',payload,12)[0]
gltf = json.loads(payload[20:20+json_length])
blink = {'name':'blink','samplers':[],'channels':[]}
others=[]
for animation in gltf.get('animations',[]):
    if animation['name']=='blink' or animation['name'].startswith('blink_eye_'):
        offset=len(blink['samplers'])
        blink['samplers'].extend(animation['samplers'])
        for channel in animation['channels']:
            channel['sampler']+=offset
            blink['channels'].append(channel)
    else:
        others.append(animation)
gltf['animations']=others+[blink]
encoded=json.dumps(gltf,separators=(',',':')).encode('utf-8')
encoded+=b' '*((-len(encoded))%4)
tail=payload[20+json_length:]
glb_path.write_bytes(struct.pack('<4sII',b'glTF',2,20+len(encoded)+len(tail))+
                     struct.pack('<I4s',len(encoded),b'JSON')+encoded+tail)
scene.render.filepath = str(QA/'blender-neutral.png')
bpy.ops.render.render(write_still=True)
face_objects = [head]+eye_objects+lid_objects
face_actions = {o.name:o.data.shape_keys.animation_data.action for o in face_objects}
for obj in face_objects:
    obj.data.shape_keys.animation_data.action = None
for expression in expressions:
    for obj in face_objects:
        for key in obj.data.shape_keys.key_blocks:
            key.value = float(key.name == expression)
    scene.render.filepath = str(QA/('blender-'+expression+'.png'))
    bpy.ops.render.render(write_still=True)
for obj in face_objects:
    for key in obj.data.shape_keys.key_blocks:
        key.value = 0
    obj.data.shape_keys.animation_data.action = face_actions[obj.name]
for clip, frame in [('wave', 18), ('recoil', 6), ('idle', 31), ('walk', 8), ('jump', 14), ('cheer', 10), ('think', 16)]:
    rig.animation_data.action = bpy.data.actions[clip]
    scene.frame_set(frame)
    scene.render.filepath = str(QA/('blender-'+clip+'.png'))
    bpy.ops.render.render(write_still=True)
report = {'blenderVersion': bpy.app.version_string, 'meshCount': len(objects),
          'boneCount': len(PIVOTS), 'vertices': sum(len(o.data.vertices) for o in objects.values()),
          'clips': list(clips)+['blink'], 'morphTargets': expressions,
          'expressionsComplete': False,
          'note': 'Repaired arm art, trimmed coat coverage, independent eye/lid meshes. Full-range art acceptance remains outstanding.'}
(QA/'blender-build.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
print(json.dumps(report))
