# Goodwill Tailor

A clean, responsive single-page tailoring order management prototype.

## Run
Open `index.html` in a browser. For the best development workflow, open the folder in VS Code and use Live Server.

## Demo
Admin login:
- Username: `admin`
- Password: `goodwill123`

## Roles
- Admin: overview, staff login management, customer access
- Staff: search/enroll customers, create orders, upload reference photos, update order status
- Customer: mobile-number login and read-only order tracking

## Storage
The app uses `window.storage` when available, with browser `localStorage` as a fallback.

## Important
This is a front-end prototype. Passwords and order/customer data are stored client-side and are not suitable for production security. A production version should use an authenticated backend/database.
