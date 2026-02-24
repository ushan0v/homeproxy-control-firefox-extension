# HomeProxy Control

Firefox-расширение для управления сервисом HomeProxy через `homeproxy-api` (OpenWrt).

## Что умеет

- включение/выключение службы HomeProxy
- проверка маршрута для текущего сайта
- просмотр и редактирование правил
- sniffer запросов и быстрое создание правил
- подключение к API по адресу/токену

## Требования

- Node.js 20+
- npm 10+
- Firefox

## Быстрый старт

```bash
npm install
npm run build
```

## Полезные команды

```bash
npm run dev          # локальная разработка
npm run build        # production build
npm run build:xpi    # сборка .xpi пакета
npm run run:firefox  # запуск через web-ext
```

Финальный `.xpi` создается в `web-ext-artifacts/homeproxy_control.xpi`.
