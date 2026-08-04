import re
import sys

DECL_RE = re.compile(r"\bclass\s+([A-Za-z_]\w*)\s*(?::([^{;]+))?\{")

HEADERS = [
    "datacache/imdlcache.h",
    "appframework/IAppSystem.h",
    "eiface.h",
    "engine/IVModelInfo.h",
    "ispatialpartition.h",
    "engine/IEngineTrace.h",
    "engine/IStaticPropMgr.h",
    "igameevents.h",
    "datacache/idatacache.h",
    "SoundEmitterSystem/isoundemittersystembase.h",
    "engine/iserverplugin.h",
    "engine/IEngineSound.h",
    "ivoiceserver.h",
    "networkstringtabledefs.h",
    "vscript/ivscript.h",
    "toolframework/iserverenginetools.h",
    "ilagcompensationmanager.h",
    "itempents.h",
    "AI_ResponseSystem.h",
    "engine/ivdebugoverlay.h",
    "scenefilecache/ISceneFileCache.h",
    "filesystem.h",
    "vphysics_interface.h",
    "icvar.h",
]

DEFAULT_TARGETS = [
    "IMDLCache",
    "IEngineTrace",
    "IStaticPropMgrServer",
    "IGameEventManager2",
    "IDataCache",
    "ISoundEmitterSystemBase",
    "IServerPluginHelpers",
    "IEngineSound",
    "IVoiceServer",
    "IUploadGameStats",
    "IScriptManager",
    "IServerEngineTools",
    "ILagCompensationManager",
    "ITempEntsSystem",
    "IResponseSystem",
    "IVDebugOverlay",
    "ISceneFileCache",
    "IFileSystem",
    "IPhysicsCollision",
    "IPhysicsSurfaceProps",
    "IPhysicsEnvironment",
    "ICvar",
]

ENGINE_SKIP = {
    "PrecacheModel", "PrecacheSound", "PrecacheGeneric", "PrecacheDecal",
    "IsModelPrecached", "IsDedicatedServer", "Time", "IndexOfEdict",
    "PEntityOfEntIndex", "CreateEdict", "RemoveEdict", "GetEntityCount",
    "GetChangeAccessor", "GetGameDir", "IsInternalBuild", "GetAppID",
    "PvAllocEntPrivateData", "FreeEntPrivateData", "SaveAllocMemory", "SaveFreeMemory",
    "CreateFakeClient", "CreateFakeClientEx", "GetMapEntitiesString",
    "SetFakeClientConVarValue", "GetClientConVarValue",
}

MODEL_SKIP = {
    "GetModel", "GetModelIndex", "GetModelName", "GetModelBounds",
    "GetModelRenderBounds", "GetModelType", "GetModelFrameCount", "GetVirtualModel",
}

PARTITION_SKIP = {"CreateHandle", "DestroyHandle"}

INL_TARGETS = [
    ("IVEngineServer", "engineserver_generated.inl", ENGINE_SKIP),
    ("IVModelInfo", "modelinfo_generated.inl", MODEL_SKIP),
    ("ISpatialPartition", "spatialpartition_generated.inl", PARTITION_SKIP),
]

OPENERS = "([{<"
CLOSERS = ")]}>"


def emit_tu():
    lines = ['#include "cbase.h"']
    for header in HEADERS:
        lines.append('#include "%s"' % header)
    return "\n".join(lines) + "\n"


def strip_line_markers(text):
    return "\n".join(l for l in text.split("\n") if not l.lstrip().startswith("#"))


def build_index(text):
    index = {}
    for m in DECL_RE.finditer(text):
        name = m.group(1)
        if name in index:
            continue
        bases = []
        if m.group(2):
            for part in m.group(2).split(","):
                for keyword in ("public", "protected", "private", "virtual"):
                    part = part.replace(keyword, " ")
                part = part.strip()
                if part and "<" not in part:
                    bases.append(part)
        index[name] = (bases, m.end() - 1)
    return index


def class_body(text, offset):
    depth = 0
    for j in range(offset, len(text)):
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0:
                return text[offset + 1:j]
    sys.exit("unterminated class body")


def split_top_level(text, sep=","):
    parts = []
    depth = 0
    start = 0
    for i, ch in enumerate(text):
        if ch in OPENERS:
            depth += 1
        elif ch in CLOSERS:
            depth -= 1
        elif ch == sep and depth == 0:
            parts.append(text[start:i])
            start = i + 1
    parts.append(text[start:])
    return parts


def strip_defaults(args):
    out = []
    for param in split_top_level(args):
        head = split_top_level(param, "=")[0].strip()
        if head:
            out.append(head)
    return ", ".join(out)


def match_open_paren(decl, close):
    depth = 0
    for i in range(close, -1, -1):
        if decl[i] == ")":
            depth += 1
        elif decl[i] == "(":
            depth -= 1
            if depth == 0:
                return i
    return -1


def strip_nested_classes(body):
    out = []
    i = 0
    pat = re.compile(r"\b(?:class|struct|union)\b[^{;]*\{")
    while True:
        m = pat.search(body, i)
        if not m:
            out.append(body[i:])
            break
        out.append(body[i:m.start()])
        depth = 0
        j = m.end() - 1
        while j < len(body):
            if body[j] == "{":
                depth += 1
            elif body[j] == "}":
                depth -= 1
                if depth == 0:
                    j += 1
                    break
            j += 1
        while j < len(body) and body[j].isspace():
            j += 1
        if j < len(body) and body[j] == ";":
            j += 1
        i = j
    return "".join(out)


def strip_attributes(decl):
    while True:
        at = decl.find("__attribute__")
        if at < 0:
            return decl
        i = decl.find("(", at)
        if i < 0:
            return decl[:at].strip()
        depth = 0
        j = i
        while j < len(decl):
            if decl[j] == "(":
                depth += 1
            elif decl[j] == ")":
                depth -= 1
                if depth == 0:
                    j += 1
                    break
            j += 1
        decl = (decl[:at] + " " + decl[j:]).strip()


def parse_methods(body):
    body = strip_nested_classes(body)
    body = re.sub(r"\s+", " ", body)
    found = []
    for m in re.finditer(r"\bvirtual\s+(.+?)\s*=\s*0\s*;", body):
        decl = strip_attributes(m.group(1).strip())
        inner = None
        for extra in re.finditer(r"\bvirtual\s+", decl):
            inner = extra.end()
        if inner is not None:
            decl = decl[inner:].strip()
        if decl.startswith("~") or "~" in decl.split("(")[0]:
            continue
        close = decl.rfind(")")
        paren = match_open_paren(decl, close) if close >= 0 else -1
        if paren < 0:
            continue
        args = strip_defaults(decl[paren + 1:close].strip())
        head = decl[:paren].strip()
        tail = decl[close + 1:].strip()
        parts = head.rsplit(" ", 1)
        if len(parts) == 1:
            continue
        ret, fname = parts[0].strip(), parts[1].strip()
        while fname.startswith("*"):
            ret += " *"
            fname = fname[1:]
        while fname.startswith("&"):
            ret += " &"
            fname = fname[1:]
        if not re.match(r"^[A-Za-z_]\w*$", fname):
            continue
        found.append((ret, fname, args, tail.startswith("const")))
    return found


def collect(text, index, name, seen_classes=None):
    if seen_classes is None:
        seen_classes = set()
    if name in seen_classes or name not in index:
        return []
    seen_classes.add(name)
    bases, offset = index[name]
    out = []
    for base in bases:
        out.extend(collect(text, index, base, seen_classes))
    out.extend(parse_methods(class_body(text, offset)))
    return out


def default_body(ret):
    r = " ".join(ret.split())
    if r == "void":
        return ""
    if r.endswith("&"):
        t = r[:-1].strip()
        if t.startswith("const"):
            t = t[len("const"):].strip()
        return "static char s_ret[ sizeof( %s ) ] = { 0 }; return *( %s * )s_ret;" % (t, t)
    if r.endswith("*"):
        return "return 0;"
    if r == "bool":
        return "return false;"
    if r in ("float", "double"):
        return "return 0.0f;"
    if re.match(r"^[A-Za-z_]\w*$", r):
        return "return %s();" % r
    return "return ( %s )0;" % r


def methods_for(text, index, name, skip):
    if name not in index:
        sys.exit("interface not found: " + name)
    lines = []
    seen = set()
    for ret, fname, args, is_const in collect(text, index, name):
        if fname in skip:
            continue
        sig = "%s(%s)%s" % (fname, args, is_const)
        if sig in seen:
            continue
        seen.add(sig)
        lines.append("\t%s %s( %s )%s override { %s }" % (
            ret, fname, args, " const" if is_const else "", default_body(ret)))
    return lines


def generate(tu_path, out_dir):
    text = strip_line_markers(open(tu_path, encoding="utf-8", errors="replace").read())
    index = build_index(text)

    for name, out_name, skip in INL_TARGETS:
        lines = methods_for(text, index, name, skip)
        open(out_dir + "/" + out_name, "w", encoding="utf-8", newline="\n").write(
            "\n".join(lines) + "\n")
        print("%s: %d methods -> %s" % (name, len(lines), out_name))

    bodies = []
    for name in DEFAULT_TARGETS:
        lines = methods_for(text, index, name, set())
        bodies.append("class CSimDefault_%s : public %s\n{\npublic:\n%s\n};" % (
            name, name, "\n".join(lines)))
        print("%s: %d methods" % (name, len(lines)))

    out = ["#ifndef SIM_DEFAULTS_GENERATED_H", "#define SIM_DEFAULTS_GENERATED_H", ""]
    for header in HEADERS:
        out.append('#include "%s"' % header)
    out.append("")
    out.extend(bodies)
    out.append("")
    out.append("#endif")
    open(out_dir + "/defaults_generated.h", "w", encoding="utf-8", newline="\n").write(
        "\n".join(out) + "\n")


if __name__ == "__main__":
    if sys.argv[1] == "--tu":
        open(sys.argv[2], "w", encoding="utf-8", newline="\n").write(emit_tu())
    else:
        generate(sys.argv[1], sys.argv[2])
