import re


def parse_snippets(md_path, ts_path):
    with open(md_path, "r", encoding="utf-8") as f:
        chars = f.read()

    # State machine to clean up regexes
    # We look for the sequence "trigger:" followed by optional whitespace and then a "/"
    # When inside a regex, we consume until the next unescaped "/"
    # Inside the regex, we remove newlines and the following indentation.

    clean_chars = []
    i = 0
    n = len(chars)

    # Simple Lookahead helper
    def peek(offset=1):
        if i + offset < n:
            return chars[i + offset]
        return ""

    # Helper to check if we are at "trigger:"
    def at_trigger():
        # Check if chars[i...] starts with "trigger:"
        # We can just check substring
        return chars.startswith("trigger:", i)

    while i < n:
        if at_trigger():
            # Append "trigger:"
            clean_chars.extend(list("trigger:"))
            i += 8  # len("trigger:")

            # Consume whitespace
            while i < n and chars[i].isspace():
                clean_chars.append(chars[i])
                i += 1

            # Check if now at start of regex
            if i < n and chars[i] == "/":
                # Start of regex!
                clean_chars.append("/")
                i += 1

                # Consume regex content
                while i < n:
                    c = chars[i]
                    if c == "\\":
                        # Escape next char
                        # verify we don't output newline if escaped newline?
                        # usually regex escape is \char.
                        # We just copy backslash and next char.
                        clean_chars.append(c)
                        i += 1
                        if i < n:
                            clean_chars.append(chars[i])
                            i += 1
                        continue

                    if c == "/":
                        # End of regex
                        clean_chars.append(c)
                        i += 1
                        break

                    if c == "\n":
                        # Found a newline in regex! SKIP IT and skip following spaces
                        i += 1
                        while i < n and chars[i].isspace():
                            i += 1
                        continue

                    # Normal char
                    clean_chars.append(c)
                    i += 1
            else:
                # Not a regex (maybe a string "trigger"), just continue
                continue
        else:
            # Copy normal char
            clean_chars.append(chars[i])
            i += 1

    result = "".join(clean_chars)

    # Fix Types
    # Handle "(match) =>" with loose spacing
    # Regex: \(match\)\s*=>
    result = re.sub(r"\(match\)\s*=>", "(match: any) =>", result)
    # Fix array type
    result = re.sub(r"let arr = \[\];", "let arr: number[][] = [];", result)

    # Wrap
    header = (
        "import { Macro } from './types';\n\nexport const defaultSnippets: Macro[] = "
    )
    footer = ";"

    with open(ts_path, "w", encoding="utf-8") as f:
        f.write(header + result + footer)


if __name__ == "__main__":
    parse_snippets("local_docs/snippets.md", "src/lib/defaultSnippets.ts")
