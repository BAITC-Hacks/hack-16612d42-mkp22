import httpx
import json

# Запрос к API каталога ekt.kz
response = httpx.get("https://ekt.kz/api/products")
data = response.json()

# Сохраняем в файл catalog.json в корень проекта
with open("catalog.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("Каталог успешно выгружен и сохранен в catalog.json!")