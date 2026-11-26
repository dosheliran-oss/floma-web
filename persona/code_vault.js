// Generated from persona/code_vault.json by pc_companion/code_vault.py (ota.py runs it) - edit the JSON, not this file.
window.FLOMA_CODE_VAULT = {
 "version": 1,
 "_comment": "Floma - the personal Code Vault (Step 72, the @code skill / מאגר קודים). Hand-edited: each language maps to a list of snippets {id, title, description, code}; a new language is just a new key. Read by pc_companion/skills.py (code_vault), web_client/skills.js (through the mirror persona/code_vault.js) and Android's Skills.kt. After editing: python pc_companion/ota.py (writes the mirror and version.json), then persona-tests/make_cases.py.",
 "languages": {
  "Python": [
   {
    "id": "py-read-json",
    "title": "קריאה וכתיבה של JSON",
    "description": "Load a JSON file into a dict and save it back, UTF-8 and readable.",
    "code": "import json\nfrom pathlib import Path\n\n\ndef load_json(path: str | Path, default=None):\n    \"\"\"The file's data, or [default] when it's missing or broken.\"\"\"\n    try:\n        return json.loads(Path(path).read_text(encoding=\"utf-8\"))\n    except (OSError, ValueError):\n        return default\n\n\ndef save_json(path: str | Path, data) -> None:\n    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding=\"utf-8\")\n"
   },
   {
    "id": "py-list-files",
    "title": "רשימת קבצים בתיקייה (רקורסיבית)",
    "description": "Every file under a folder with a given extension, newest first.",
    "code": "from pathlib import Path\n\n\ndef files_by_type(folder: str, suffix: str = \".pdf\") -> list[Path]:\n    files = [p for p in Path(folder).rglob(f\"*{suffix}\") if p.is_file()]\n    return sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)\n\n\nfor path in files_by_type(\".\", \".py\"):\n    print(path)\n"
   },
   {
    "id": "py-http-get",
    "title": "בקשת HTTP עם timeout (בלי ספריות)",
    "description": "GET a URL with the standard library: a timeout, a User-Agent and JSON parsing.",
    "code": "import json\nimport urllib.request\n\n\ndef get_json(url: str, timeout: float = 10.0) -> dict:\n    request = urllib.request.Request(url, headers={\"User-Agent\": \"my-script/1.0\"})\n    with urllib.request.urlopen(request, timeout=timeout) as response:\n        return json.loads(response.read().decode(\"utf-8\"))\n\n\nprint(get_json(\"https://api.github.com\"))\n"
   },
   {
    "id": "py-dataclass",
    "title": "dataclass עם ערכי ברירת מחדל",
    "description": "A small typed record with defaults, a computed property and a readable repr.",
    "code": "from dataclasses import dataclass, field\n\n\n@dataclass\nclass Student:\n    name: str\n    grades: list[int] = field(default_factory=list)\n\n    @property\n    def average(self) -> float:\n        return sum(self.grades) / len(self.grades) if self.grades else 0.0\n\n\ndana = Student(\"Dana\", [90, 85, 100])\nprint(dana, round(dana.average, 1))\n"
   }
  ],
  "JavaScript": [
   {
    "id": "js-fetch-json",
    "title": "fetch עם timeout וטיפול בשגיאות",
    "description": "GET JSON with an AbortController timeout and a clear error for bad statuses.",
    "code": "async function getJson(url, timeoutMs = 10000) {\n  const controller = new AbortController();\n  const timer = setTimeout(() => controller.abort(), timeoutMs);\n  try {\n    const response = await fetch(url, { signal: controller.signal });\n    if (!response.ok) throw new Error(`HTTP ${response.status}`);\n    return await response.json();\n  } finally {\n    clearTimeout(timer);\n  }\n}\n\ngetJson(\"https://api.github.com\").then(console.log, console.error);\n"
   },
   {
    "id": "js-debounce",
    "title": "debounce לאירועים (הקלדה, שינוי גודל)",
    "description": "Run a function only after the calls stop for a moment.",
    "code": "function debounce(fn, waitMs = 300) {\n  let timer = null;\n  return (...args) => {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn(...args), waitMs);\n  };\n}\n\nconst search = debounce((text) => console.log(\"searching\", text), 400);\ndocument.querySelector(\"input\").addEventListener(\"input\", (e) => search(e.target.value));\n"
   },
   {
    "id": "js-local-storage",
    "title": "שמירה ב-localStorage בבטחה",
    "description": "Read and write JSON in localStorage without breaking when storage is blocked or full.",
    "code": "function load(key, fallback) {\n  try {\n    const raw = localStorage.getItem(key);\n    return raw == null ? fallback : JSON.parse(raw);\n  } catch (e) {\n    return fallback;\n  }\n}\n\nfunction save(key, value) {\n  try {\n    localStorage.setItem(key, JSON.stringify(value));\n  } catch (e) {\n    /* storage full or blocked: keep working in memory */\n  }\n}\n"
   },
   {
    "id": "js-group-by",
    "title": "קיבוץ מערך לפי מפתח",
    "description": "Group an array of objects by a key into an object of arrays.",
    "code": "function groupBy(items, key) {\n  return items.reduce((groups, item) => {\n    (groups[item[key]] ||= []).push(item);\n    return groups;\n  }, {});\n}\n\nconst people = [{ name: \"Dana\", city: \"Haifa\" }, { name: \"Avi\", city: \"Tel Aviv\" }, { name: \"Noa\", city: \"Haifa\" }];\nconsole.log(groupBy(people, \"city\"));\n"
   }
  ],
  "TypeScript": [],
  "React": [],
  "SQL": [],
  "HTML/CSS": []
 }
};
