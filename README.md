# 🏠 RoofOnClick Backend API

> A robust, scalable RESTful API powering **RoofOnClick** (*StayyNest*) — a modern PG and Hostel discovery platform tailored for students and working professionals in Indore.

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-4.x-black.svg)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose%208.x-47A248.svg)](https://www.mongodb.com/)
[![Swagger](https://img.shields.io/badge/Swagger-OpenAPI%203.0-85EA2D.svg)](http://localhost:5000/api/docs)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 🌟 Key Features

* 🔐 **Authentication & Authorization**
  * Email & Password Authentication (bcrypt hashing with 12 salt rounds).
  * Stateless JWT authentication with role-based access control (`seeker`, `owner`, `admin`).
  * Seamless Google OAuth 2.0 Integration via Passport.js (guarded for non-configured environments).
* 🏢 **Listings Management**
  * Full CRUD for PG/Hostel properties.
  * Advanced multi-filter search (by area, rent range, PG type, gender preference, amenities, sharing options, and verification status).
  * Full-text search on property titles, descriptions, and areas.
  * Geospatial search indexing (`2dsphere` on MongoDB) for coordinate-based location queries.
  * Auto-promotion of user role (`seeker` ➔ `owner`) upon creating their first listing.
  * Soft-deletion of listings with automatic AWS S3 photo batch cleanup.
* 📷 **AWS S3 Photo Uploads**
  * Direct multipart photo uploads via `multer` memory buffers piped to AWS S3.
  * Strict file type validation (JPEG, PNG, WebP) and size limits (5MB per photo, max 10 photos per listing).
  * Granular photo deletion by S3 key.
* 📩 **Enquiries & WhatsApp Integration**
  * Public enquiry submission (supports both logged-in users and anonymous visitors).
  * Dedicated Owner Inbox to view, filter, and update enquiry statuses (`new`, `seen`, `closed`).
  * Dynamic WhatsApp link generator (`wa.me`) with pre-filled message templates.
* 🛡️ **Admin Dashboard Capabilities**
  * Review and manage all listings across active, inactive, and deleted states.
  * Grant/revoke the **"Assured" Verified Badge** to property listings.
  * Manage users, search user directories, and promote/demote roles safely.
* 📖 **Interactive API Documentation**
  * Built-in Swagger UI at `/api/docs` powered by an OpenAPI 3.0 specification with JWT persistence.

---

## 🏗️ Tech Stack

* **Runtime:** Node.js
* **Framework:** Express.js
* **Database:** MongoDB with Mongoose ODM
* **Security & Utility:** Helmet, CORS (environment-aware), Morgan, Express-Rate-Limit, Express-Validator
* **Authentication:** JSON Web Tokens (JWT), Passport.js (Google OAuth 2.0)
* **Storage & Media:** AWS S3 (`@aws-sdk/client-s3`), Multer
* **Documentation:** Swagger UI Express, OpenAPI 3.0

---

## 📂 Project Structure

```text
roof-on-click-server/
└── backend/
    ├── src/
    │   ├── config/          # Database, AWS S3, Passport, & Swagger configs
    │   ├── controllers/     # Business logic (Auth, Listing, User, Enquiry, Admin)
    │   ├── middleware/      # Auth, RBAC, Upload (Multer+S3), Rate-limiting & Error handlers
    │   ├── models/          # Mongoose Schemas (User, Listing, Enquiry)
    │   ├── routes/          # Express route definitions
    │   ├── utils/           # Standard API response wrappers & WhatsApp URL builder
    │   └── app.js           # Main Express application configuration
    ├── .env.example         # Environment template
    ├── package.json         # Project dependencies and scripts
    └── server.js            # Application entry point
```

---

## 🚀 Getting Started

### Prerequisites

* [Node.js](https://nodejs.org/) (v18.0.0 or higher)
* [MongoDB](https://www.mongodb.com/) (Local installation or MongoDB Atlas cluster)
* AWS Account (optional for S3 photo uploads)
* Google Cloud Console Project (optional for Google OAuth)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/adityajunwal/roof-on-click-server.git
   cd roof-on-click-server/backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Create a `.env` file in the `backend/` directory by copying `.env.example`:
   ```bash
   cp .env.example .env
   ```

   Fill in your configuration details:
   ```env
   # Server Configuration
   PORT=5000
   NODE_ENV=development
   ENV=dev                       # 'dev' allows all CORS origins; 'prod' restricts to FRONTEND_URL

   # Database
   MONGO_URI=mongodb://localhost:27017/roofOnClick

   # JWT Secret
   JWT_SECRET=your_super_secret_jwt_key
   JWT_EXPIRES_IN=7d

   # Google OAuth (Optional - Server operates gracefully if left blank)
   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback

   # AWS S3 (Optional for media uploads)
   AWS_ACCESS_KEY_ID=your_aws_access_key
   AWS_SECRET_ACCESS_KEY=your_aws_secret_key
   AWS_REGION=ap-south-1
   AWS_S3_BUCKET_NAME=roofOnClick-listings

   # Frontend Client URL
   FRONTEND_URL=https://stayynest.vercel.app
   ```

4. **Run the Development Server:**
   ```bash
   npm run dev
   ```

5. **Verify Installation:**
   * Health Check: [http://localhost:5000/api/health](http://localhost:5000/api/health)
   * Swagger Documentation: [http://localhost:5000/api/docs](http://localhost:5000/api/docs)

---

## 📖 API Documentation & Testing

Interactive API documentation is powered by Swagger UI and available at:

```text
http://localhost:5000/api/docs
```

### Authentication via Swagger:
1. Register or login via `/api/auth/register` or `/api/auth/login`.
2. Copy the returned `token` string from the JSON response.
3. Click the **Authorize 🔓** button at the top right of the Swagger UI.
4. Enter: `Bearer <your_token>` and click **Authorize**.

---

## ⚡ Core API Endpoints Overview

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| **POST** | `/api/auth/register` | Public | Register new user account |
| **POST** | `/api/auth/login` | Public | Authenticate user & return JWT |
| **GET** | `/api/auth/me` | Protected | Fetch authenticated user profile |
| **GET** | `/api/listings` | Public | Browse active listings (with filters & search) |
| **GET** | `/api/listings/:id` | Public | View single listing details |
| **POST** | `/api/listings` | Owner/Admin | Create new property listing |
| **POST** | `/api/listings/:id/photos` | Owner/Admin | Upload property photos to AWS S3 |
| **GET** | `/api/listings/:id/whatsapp-link` | Public | Generate pre-filled WhatsApp chat link |
| **POST** | `/api/enquiries/:listingId` | Public | Submit enquiry for a property |
| **GET** | `/api/enquiries/received` | Owner/Admin | View enquiries received on owner listings |
| **PUT** | `/api/admin/listings/:id/verify` | Admin | Toggle property verification badge |

---

## 🛡️ Security Best Practices Implemented

* **Password Security:** Hashes passwords with `bcryptjs` using 12 salt rounds; sensitive fields excluded by default (`select: false`).
* **HTTP Headers:** Hardened using `helmet`.
* **Rate Limiting:** IP rate limiting enforced on sensitive auth endpoints to prevent brute-force attacks.
* **CORS Handling:** Dynamic origin switching based on `ENV` mode (`dev` vs `prod`).
* **Input Validation:** Strict request body sanitization and validation using `express-validator`.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
