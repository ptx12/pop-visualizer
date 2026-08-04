import re
import sys

RET_VOID = "void"


def read_class(path, name):
    text = open(path, encoding="utf-8", errors="replace").read()
    start = re.search(r"abstract_class\s+" + re.escape(name) + r"\b", text)
    if not start:
        sys.exit("class not found: " + name)
    i = start.end()
    depth = 0
    started = False
    for j in range(i, len(text)):
        if text[j] == "{":
            depth += 1
            started = True
        elif text[j] == "}":
            depth -= 1
            if started and depth == 0:
                return text[i:j]
    sys.exit("unterminated class: " + name)


def strip_comments(body):
    body = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
    body = re.sub(r"//[^\n]*", "", body)
    return body


def strip_preproc(body):
    out = []
    for line in body.split("\n"):
        if line.lstrip().startswith("#"):
            continue
        out.append(line)
    return "\n".join(out)


def methods(body):
    body = strip_preproc(strip_comments(body))
    body = re.sub(r"\s+", " ", body)
    found = []
    for m in re.finditer(r"virtual\s+(.+?)\s*=\s*0\s*;", body):
        decl = m.group(1).strip()
        if "virtual" in decl:
            decl = decl[decl.rfind("virtual") + len("virtual"):].strip()
        if decl.startswith("~") or "~" in decl.split("(")[0]:
            continue
        paren = decl.rfind("(")
        close = decl.find(")", paren)
        if paren < 0 or close < 0:
            continue
        args = decl[paren + 1:close].strip()
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
        is_const = tail.startswith("const")
        found.append((ret, fname, args, is_const))
    return found


def default_body(ret):
    r = ret.strip()
    if r == RET_VOID:
        return ""
    if r.endswith("*") or r.endswith("&"):
        return "return 0;"
    if r in ("bool",):
        return "return false;"
    if r in ("float", "double"):
        return "return 0.0f;"
    if r.startswith("const char") or r.startswith("char const"):
        return 'return "";'
    return "return (%s)0;" % r


def emit(path, cls, out_name, skip):
    body = read_class(path, cls)
    lines = []
    seen = set()
    for ret, fname, args, is_const in methods(body):
        if fname in skip:
            continue
        clean_args = re.sub(r"=\s*[^,]+(?=,|$)", "", args).strip()
        sig = "%s %s(%s)%s" % (ret, fname, clean_args, " const" if is_const else "")
        if sig in seen:
            continue
        seen.add(sig)
        lines.append("\t%s %s( %s )%s override { %s }" % (
            ret, fname, clean_args, " const" if is_const else "", default_body(ret)))
    open(out_name, "w", encoding="utf-8", newline="\n").write("\n".join(lines) + "\n")
    print("%s: %d methods -> %s" % (cls, len(lines), out_name))


if __name__ == "__main__":
    sdk = sys.argv[1]
    out = sys.argv[2]
    engine_skip = {
        "PrecacheModel", "PrecacheSound", "PrecacheGeneric", "PrecacheDecal",
        "IsModelPrecached", "IsDedicatedServer", "Time", "IndexOfEdict",
        "PEntityOfEntIndex", "CreateEdict", "RemoveEdict", "GetEntityCount",
        "GetChangeAccessor", "GetGameDir", "IsInternalBuild", "GetAppID",
        "PvAllocEntPrivateData", "FreeEntPrivateData", "SaveAllocMemory", "SaveFreeMemory",
    }
    model_skip = {
        "GetModel", "GetModelIndex", "GetModelName", "GetModelBounds",
        "GetModelRenderBounds", "GetModelType", "GetModelFrameCount", "GetVirtualModel",
    }
    emit(sdk + "/public/eiface.h", "IVEngineServer", out + "/engineserver_generated.inl", engine_skip)
    emit(sdk + "/public/engine/IVModelInfo.h", "IVModelInfo", out + "/modelinfo_generated.inl", model_skip)

    partition_skip = {"CreateHandle", "DestroyHandle"}
    emit(sdk + "/public/ispatialpartition.h", "ISpatialPartition",
         out + "/spatialpartition_generated.inl", partition_skip)
