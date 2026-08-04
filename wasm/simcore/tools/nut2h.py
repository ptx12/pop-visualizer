import sys

src, dst, name = sys.argv[1], sys.argv[2], sys.argv[3]

text = open(src, "rb").read().decode("utf-8", "replace")
out = []
for line in text.split("\n"):
    line = line.rstrip("\r")
    line = line.replace("\\", "\\\\").replace('"', '\\"')
    out.append('\t"%s\\n"' % line)

with open(dst, "w", encoding="utf-8", newline="\n") as f:
    f.write("const char g_Script_%s[] =\n%s;\n" % (name, "\n".join(out)))
