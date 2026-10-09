# Export each asset of a Blender city pack to its own GLB for js/cityDressing.js.
#
#   blender -b assets/city-real/src/city-pack.blend \
#     --python tools/blender/export_city_pack.py -- assets/city-real
#
# Every top-level asset (with its child parts) is exported with its modifiers applied, moved so its footprint is
# centred on the origin with its base at y=0, and its textures downscaled to at
# most MAX_TEX px and re-encoded as JPEG. Writes <out>/<collection>/<name>.glb
# and <out>/manifest.json (size and triangle count per model).
import bpy, sys, os, json
from mathutils import Vector

MAX_TEX = 2048   # the pack's photos are <= 1600 px: keep them at full resolution
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'assets/city-real')
SKIP_COLLECTIONS = {'Pipes'}                # kitbash bits
SKIP_OBJECTS = {'road', 'side_walk', 'lane_x2', 'straight01_d:_25m', 'backlight_2x0.5m', 'bar_chair'}

# Triangle budget per collection. A street repeats each model dozens of times,
# so the source meshes (up to 68k triangles after modifiers) are reduced:
# first coplanar faces are merged (no visible change on flat facades), then a
# collapse decimate brings anything still over budget down to it.
BUDGET = {'Buildings': 8000, 'Shops': 2500, 'Extras': 1500, 'Road_sign': 400, 'Traffic_light': 3000,
          'Roads': 1500}
PROP_BUDGET = 2500                           # anything else (street furniture)
HEAVY_BUDGET = 14000                         # the large back-row blocks
HEAVY = {'building_1', 'building_3', 'building_8', 'building_9'}


def tri_count(obj):
    ev = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    n = sum(len(p.vertices) - 2 for p in me.polygons)
    ev.to_mesh_clear()
    return n


def soften(obj):
    """Round the sharp corners a little and shade curved parts smoothly, so a
    facade catches the light along its edges instead of reading as a flat box."""
    import math
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    except Exception:
        pass
    bevel = obj.modifiers.new('soften_bevel', 'BEVEL')
    bevel.width = 0.06
    bevel.segments = 2
    bevel.limit_method = 'ANGLE'
    bevel.angle_limit = math.radians(40)
    bevel.harden_normals = True
    bevel.use_clamp_overlap = True


def fit_budget(obj, budget):
    """Append decimation so the evaluated mesh lands at or under `budget`."""
    if tri_count(obj) <= budget:
        return
    planar = obj.modifiers.new('fit_planar', 'DECIMATE')
    planar.decimate_type = 'DISSOLVE'
    planar.angle_limit = 0.0175           # 1 degree
    planar.use_dissolve_boundaries = False
    planar.delimit = {'UV', 'MATERIAL'}
    n = tri_count(obj)
    if n > budget:
        collapse = obj.modifiers.new('fit_collapse', 'DECIMATE')
        collapse.decimate_type = 'COLLAPSE'
        collapse.ratio = budget / n
        collapse.use_collapse_triangulate = True

# downscale every texture once (they are packed in the .blend)
for im in bpy.data.images:
    if im.size[0] == 0:
        continue
    w, h = im.size
    k = MAX_TEX / max(w, h)
    if k < 1:
        im.scale(max(1, int(w * k)), max(1, int(h * k)))

depsgraph = bpy.context.evaluated_depsgraph_get()
manifest_path = os.path.join(OUT, 'manifest.json')
manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}


def folder_for(obj):
    for c in obj.users_collection:
        if c.name != 'Scene Collection':
            return c.name
    return 'Props'


def family(obj):
    out = [obj]
    for ch in obj.children_recursive:
        if ch.type == 'MESH':
            out.append(ch)
    return out


roots = [o for o in bpy.data.objects
         if o.type == 'MESH' and o.parent is None and (o.asset_data is not None or not any(x.asset_data for x in bpy.data.objects))]
for obj in roots:
    coll = folder_for(obj)
    name = obj.name.lower().replace(' ', '_')
    if coll in SKIP_COLLECTIONS or name in SKIP_OBJECTS:
        continue
    folder = os.path.join(OUT, coll.lower().replace(' ', '_'))
    os.makedirs(folder, exist_ok=True)
    parts = family(obj)
    # asset-library files often keep assets out of the scene: link them in
    for p in parts:
        if p.name not in bpy.context.view_layer.objects:
            bpy.context.scene.collection.objects.link(p)
    bpy.context.view_layer.update()
    budget = HEAVY_BUDGET if name in HEAVY else BUDGET.get(coll, PROP_BUDGET)
    if coll in ('Buildings', 'Shops') and name not in HEAVY:   # back-row blocks are seen from afar
        for p in parts:
            soften(p)
    for p in parts:
        fit_budget(p, max(200, budget // len(parts)))
    depsgraph = bpy.context.evaluated_depsgraph_get()
    # world-space bounds of the evaluated (modifier-applied) meshes
    corners = []
    for p in parts:
        ev = p.evaluated_get(depsgraph)
        corners += [p.matrix_world @ Vector(c) for c in ev.bound_box]
    mn = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    mx = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    shift = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    saved = obj.matrix_world.copy()
    obj.matrix_world.translation -= shift     # children follow their parent
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.hide_set(False)
        p.select_set(True)
    bpy.context.view_layer.objects.active = obj
    path = os.path.join(folder, name + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_apply=True, export_image_format='JPEG', export_jpeg_quality=82,
        export_yup=True, export_cameras=False, export_lights=False,
        export_animations=False, export_extras=False,
    )
    obj.matrix_world = saved
    bpy.context.view_layer.update()
    tris = sum(tri_count(p) for p in parts)
    size = mx - mn
    manifest[f"{coll.lower().replace(' ', '_')}/{name}"] = {
        'w': round(size.x, 2), 'd': round(size.y, 2), 'h': round(size.z, 2),
        'tris': tris, 'bytes': os.path.getsize(path),
    }
    print('EXPORTED', coll, name, tris)

with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
    json.dump(manifest, f, indent=1)
print('DONE', len(manifest))
