/**
 * OpenAPI 3.0 specification for RoofOnClick API.
 * Served at GET /api/docs via swagger-ui-express.
 */
const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'RoofOnClick API',
    version: '1.0.0',
    description:
      'Backend API for RoofOnClick — a PG/Hostel listing platform for Indore. ' +
      'Authenticate with the `/api/auth/login` endpoint, copy the returned JWT, ' +
      'then click **Authorize** and paste it as `Bearer <token>`.',
    contact: { name: 'RoofOnClick Dev Team' },
  },
  servers: [
    { url: 'http://localhost:5000', description: 'Local development' },
    { url: 'https://your-production-domain.com', description: 'Production' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter: Bearer <your_jwt_token>',
      },
    },
    schemas: {
      // ─── Common ─────────────────────────────────────────────
      SuccessResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Operation successful.' },
          data: { type: 'object' },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'Something went wrong.' },
          errors: { type: 'array', items: { type: 'object' } },
        },
      },
      Pagination: {
        type: 'object',
        properties: {
          total: { type: 'integer', example: 84 },
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 12 },
          totalPages: { type: 'integer', example: 7 },
        },
      },
      // ─── User ───────────────────────────────────────────────
      User: {
        type: 'object',
        properties: {
          _id: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d1' },
          name: { type: 'string', example: 'Rahul Sharma' },
          email: { type: 'string', format: 'email', example: 'rahul@example.com' },
          role: { type: 'string', enum: ['seeker', 'owner', 'admin'], example: 'seeker' },
          phone: { type: 'string', example: '+919876543210' },
          avatar: { type: 'string', example: 'https://example.com/avatar.jpg' },
          isVerified: { type: 'boolean', example: false },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      // ─── Listing ────────────────────────────────────────────
      Listing: {
        type: 'object',
        properties: {
          _id: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d2' },
          title: { type: 'string', example: 'Cozy PG Near IIT Indore' },
          type: { type: 'string', enum: ['hostel', 'pg', 'shared-room', 'private-room'] },
          gender: { type: 'string', enum: ['boys', 'girls', 'co-ed'] },
          description: { type: 'string' },
          address: {
            type: 'object',
            properties: {
              street: { type: 'string' },
              area: { type: 'string', example: 'Vijay Nagar' },
              city: { type: 'string', example: 'Indore' },
              pincode: { type: 'string', example: '452010' },
              coordinates: {
                type: 'object',
                properties: {
                  type: { type: 'string', example: 'Point' },
                  coordinates: { type: 'array', items: { type: 'number' }, example: [75.8577, 22.7196] },
                },
              },
            },
          },
          rent: {
            type: 'object',
            properties: {
              monthly: { type: 'number', example: 8000 },
              deposit: { type: 'number', example: 16000 },
              foodIncluded: { type: 'boolean', example: true },
            },
          },
          amenities: { type: 'array', items: { type: 'string' }, example: ['wifi', 'ac', 'laundry'] },
          sharingOptions: { type: 'array', items: { type: 'number' }, example: [1, 2, 3] },
          photos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                url: { type: 'string' },
                key: { type: 'string' },
              },
            },
          },
          ownerWhatsapp: { type: 'string', example: '919876543210' },
          status: { type: 'string', enum: ['active', 'inactive', 'deleted'], example: 'active' },
          isVerified: { type: 'boolean', example: false },
          viewCount: { type: 'number', example: 42 },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      // ─── Enquiry ────────────────────────────────────────────
      Enquiry: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          listing: { type: 'string', description: 'Listing ObjectId' },
          seeker: { type: 'string', description: 'User ObjectId (null if unauthenticated)' },
          name: { type: 'string', example: 'Priya Verma' },
          phone: { type: 'string', example: '+919876543211' },
          message: { type: 'string', example: 'Is the room still available?' },
          status: { type: 'string', enum: ['new', 'seen', 'closed'], example: 'new' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },

  // ─── Tags ────────────────────────────────────────────────────────────────────
  tags: [
    { name: 'Auth', description: 'Authentication — register, login, Google OAuth, profile' },
    { name: 'Listings', description: 'Browse and manage property listings' },
    { name: 'Users', description: 'User profile, saved listings, search history' },
    { name: 'Enquiries', description: 'Submit and manage enquiries + WhatsApp link' },
    { name: 'Admin', description: 'Admin-only — user and listing management' },
  ],

  // ─── Paths ───────────────────────────────────────────────────────────────────
  paths: {
    // ══════════════════════════════════════════════════════════════════════════
    // AUTH
    // ══════════════════════════════════════════════════════════════════════════
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                  name: { type: 'string', example: 'Rahul Sharma' },
                  email: { type: 'string', format: 'email', example: 'rahul@example.com' },
                  password: { type: 'string', minLength: 8, example: 'MySecret@123' },
                  role: { type: 'string', enum: ['seeker', 'owner'], default: 'seeker' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'User created, returns JWT + user object' },
          409: { description: 'Email already registered' },
          422: { description: 'Validation error' },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login with email and password',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'rahul@example.com' },
                  password: { type: 'string', example: 'MySecret@123' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Login successful, returns JWT + user object' },
          401: { description: 'Invalid credentials' },
          422: { description: 'Validation error' },
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get current authenticated user',
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'Current user profile with saved listings populated' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Logout (stateless — client should clear the token)',
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'Logout acknowledged' },
        },
      },
    },
    '/api/auth/google': {
      get: {
        tags: ['Auth'],
        summary: 'Initiate Google OAuth flow',
        description: 'Redirects to Google consent screen. Returns 503 if OAuth is not configured.',
        responses: {
          302: { description: 'Redirect to Google' },
          503: { description: 'OAuth not configured on this server' },
        },
      },
    },
    '/api/auth/google/callback': {
      get: {
        tags: ['Auth'],
        summary: 'Google OAuth callback — issues JWT and redirects to frontend',
        description: 'Handled by Passport. Redirects to `FRONTEND_URL/auth/callback?token=<jwt>`',
        responses: {
          302: { description: 'Redirect to frontend with JWT token' },
          503: { description: 'OAuth not configured on this server' },
        },
      },
    },

    // ══════════════════════════════════════════════════════════════════════════
    // LISTINGS
    // ══════════════════════════════════════════════════════════════════════════
    '/api/listings': {
      get: {
        tags: ['Listings'],
        summary: 'Browse all active listings',
        description: 'Supports filters, pagination, and sorting. Saves search history for authenticated users.',
        parameters: [
          { in: 'query', name: 'area', schema: { type: 'string' }, example: 'Vijay Nagar' },
          { in: 'query', name: 'type', schema: { type: 'string', enum: ['hostel', 'pg', 'shared-room', 'private-room'] } },
          { in: 'query', name: 'gender', schema: { type: 'string', enum: ['boys', 'girls', 'co-ed'] } },
          { in: 'query', name: 'minRent', schema: { type: 'number' }, example: 5000 },
          { in: 'query', name: 'maxRent', schema: { type: 'number' }, example: 15000 },
          { in: 'query', name: 'amenities', schema: { type: 'string' }, description: 'Comma-separated: wifi,ac,laundry', example: 'wifi,ac' },
          { in: 'query', name: 'sharing', schema: { type: 'string' }, description: 'Comma-separated numbers: 1,2,3', example: '1,2' },
          { in: 'query', name: 'verified', schema: { type: 'boolean' }, description: 'Only show Assured listings' },
          { in: 'query', name: 'q', schema: { type: 'string' }, description: 'Full-text search' },
          { in: 'query', name: 'sort', schema: { type: 'string', enum: ['newest', 'rent_asc', 'rent_desc'] }, default: 'newest' },
          { in: 'query', name: 'page', schema: { type: 'integer', default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 12, maximum: 50 } },
        ],
        responses: {
          200: { description: 'Paginated list of listings' },
        },
      },
      post: {
        tags: ['Listings'],
        summary: 'Create a new listing (auto-promotes seeker → owner)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'type', 'gender', 'rent', 'address'],
                properties: {
                  title: { type: 'string', example: 'Boys PG in Vijay Nagar' },
                  type: { type: 'string', enum: ['hostel', 'pg', 'shared-room', 'private-room'] },
                  gender: { type: 'string', enum: ['boys', 'girls', 'co-ed'] },
                  description: { type: 'string' },
                  address: {
                    type: 'object',
                    properties: {
                      street: { type: 'string' },
                      area: { type: 'string', example: 'Vijay Nagar' },
                      city: { type: 'string', default: 'Indore' },
                      pincode: { type: 'string' },
                    },
                  },
                  rent: {
                    type: 'object',
                    properties: {
                      monthly: { type: 'number', example: 8000 },
                      deposit: { type: 'number', example: 16000 },
                      foodIncluded: { type: 'boolean', default: false },
                    },
                  },
                  amenities: { type: 'array', items: { type: 'string' }, example: ['wifi', 'ac'] },
                  sharingOptions: { type: 'array', items: { type: 'number' }, example: [1, 2] },
                  ownerWhatsapp: { type: 'string', example: '919876543210' },
                  totalRooms: { type: 'number' },
                  availableRooms: { type: 'number' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Listing created' },
          401: { description: 'Unauthorized' },
          422: { description: 'Validation error' },
        },
      },
    },
    '/api/listings/{id}': {
      get: {
        tags: ['Listings'],
        summary: 'Get single listing (increments viewCount, pushes to recentlyViewed if logged in)',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Listing detail' },
          404: { description: 'Not found' },
        },
      },
      put: {
        tags: ['Listings'],
        summary: 'Update a listing (owner or admin)',
        security: [{ bearerAuth: [] }],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', description: 'Any updatable listing fields' },
            },
          },
        },
        responses: {
          200: { description: 'Listing updated' },
          403: { description: 'Not the owner' },
          404: { description: 'Not found' },
        },
      },
      delete: {
        tags: ['Listings'],
        summary: 'Soft-delete a listing (sets status → deleted, cleans S3 photos)',
        security: [{ bearerAuth: [] }],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Deleted' },
          403: { description: 'Not the owner' },
          404: { description: 'Not found' },
        },
      },
    },
    '/api/listings/{id}/photos': {
      post: {
        tags: ['Listings'],
        summary: 'Upload photos to S3 (max 10 per listing, 5MB each — jpeg/png/webp)',
        security: [{ bearerAuth: [] }],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  photos: {
                    type: 'array',
                    items: { type: 'string', format: 'binary' },
                    description: 'Up to 10 image files (jpeg, png, webp)',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Photos uploaded, returns updated photos array' },
          400: { description: 'Photo limit exceeded or invalid file type' },
        },
      },
    },
    '/api/listings/{id}/photos/{photoKey}': {
      delete: {
        tags: ['Listings'],
        summary: 'Delete a specific photo from S3 and the listing',
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'photoKey', required: true, schema: { type: 'string' }, description: 'URL-encoded S3 object key' },
        ],
        responses: {
          200: { description: 'Photo deleted' },
          404: { description: 'Photo or listing not found' },
        },
      },
    },
    '/api/listings/{id}/whatsapp-link': {
      get: {
        tags: ['Listings'],
        summary: 'Get pre-built WhatsApp wa.me URL for the listing owner',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'WhatsApp URL',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        url: { type: 'string', example: 'https://wa.me/919876543210?text=Hi...' },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: 'Owner WhatsApp number not set' },
          404: { description: 'Listing not found' },
        },
      },
    },

    // ══════════════════════════════════════════════════════════════════════════
    // USERS
    // ══════════════════════════════════════════════════════════════════════════
    '/api/users/profile': {
      get: {
        tags: ['Users'],
        summary: 'Get own profile',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'User profile' }, 401: { description: 'Unauthorized' } },
      },
      put: {
        tags: ['Users'],
        summary: 'Update name, phone, or avatar',
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  phone: { type: 'string' },
                  avatar: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Profile updated' } },
      },
    },
    '/api/users/saved': {
      get: {
        tags: ['Users'],
        summary: 'Get saved/bookmarked listings',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Array of saved active listings' } },
      },
    },
    '/api/users/saved/{listingId}': {
      post: {
        tags: ['Users'],
        summary: 'Save a listing',
        security: [{ bearerAuth: [] }],
        parameters: [{ in: 'path', name: 'listingId', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Listing saved' },
          409: { description: 'Already saved' },
          404: { description: 'Listing not found' },
        },
      },
      delete: {
        tags: ['Users'],
        summary: 'Unsave a listing',
        security: [{ bearerAuth: [] }],
        parameters: [{ in: 'path', name: 'listingId', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Listing removed from saved' } },
      },
    },
    '/api/users/recently-viewed': {
      get: {
        tags: ['Users'],
        summary: 'Get recently viewed listings (max 20, most recent first)',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Array of recently viewed listings with viewedAt timestamp' } },
      },
    },
    '/api/users/search-history': {
      get: {
        tags: ['Users'],
        summary: 'Get search history (max 10, most recent first)',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Array of past search queries and filters' } },
      },
      delete: {
        tags: ['Users'],
        summary: 'Clear all search history',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Search history cleared' } },
      },
    },
    '/api/users/my-listings': {
      get: {
        tags: ['Users'],
        summary: 'Get owner\'s own listings (requires owner or admin role)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: 'query', name: 'status', schema: { type: 'string', enum: ['active', 'inactive', 'deleted'] } },
          { in: 'query', name: 'page', schema: { type: 'integer', default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 12 } },
        ],
        responses: {
          200: { description: 'Paginated list of owner\'s listings' },
          403: { description: 'Requires owner role' },
        },
      },
    },

    // ══════════════════════════════════════════════════════════════════════════
    // ENQUIRIES
    // ══════════════════════════════════════════════════════════════════════════
    '/api/enquiries/{listingId}': {
      post: {
        tags: ['Enquiries'],
        summary: 'Submit an enquiry (public — authentication optional)',
        parameters: [{ in: 'path', name: 'listingId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'phone'],
                properties: {
                  name: { type: 'string', example: 'Priya Verma' },
                  phone: { type: 'string', example: '+919876543211' },
                  message: { type: 'string', example: 'Is the room still available?' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Enquiry submitted' },
          404: { description: 'Listing not found or inactive' },
          422: { description: 'Validation error' },
        },
      },
    },
    '/api/enquiries/received': {
      get: {
        tags: ['Enquiries'],
        summary: 'Owner: Get enquiries received on their listings',
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: 'query', name: 'listingId', schema: { type: 'string' }, description: 'Filter by specific listing' },
          { in: 'query', name: 'status', schema: { type: 'string', enum: ['new', 'seen', 'closed'] } },
          { in: 'query', name: 'page', schema: { type: 'integer', default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          200: { description: 'Paginated list of enquiries' },
          403: { description: 'Requires owner role' },
        },
      },
    },
    '/api/enquiries/{id}/status': {
      put: {
        tags: ['Enquiries'],
        summary: 'Owner: Update enquiry status (new → seen → closed)',
        security: [{ bearerAuth: [] }],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: { type: 'string', enum: ['new', 'seen', 'closed'] },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Enquiry status updated' },
          403: { description: 'Not the owner of this listing' },
          404: { description: 'Enquiry not found' },
        },
      },
    },

    // ══════════════════════════════════════════════════════════════════════════
    // ADMIN
    // ══════════════════════════════════════════════════════════════════════════
    '/api/admin/listings': {
      get: {
        tags: ['Admin'],
        summary: 'Get ALL listings (including inactive/unverified)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: 'query', name: 'status', schema: { type: 'string', enum: ['active', 'inactive', 'deleted'] } },
          { in: 'query', name: 'isVerified', schema: { type: 'boolean' } },
          { in: 'query', name: 'area', schema: { type: 'string' } },
          { in: 'query', name: 'page', schema: { type: 'integer', default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          200: { description: 'Paginated admin listing view' },
          403: { description: 'Requires admin role' },
        },
      },
    },
    '/api/admin/listings/{id}/verify': {
      put: {
        tags: ['Admin'],
        summary: 'Toggle listing isVerified (grants/removes "Assured" badge)',
        security: [{ bearerAuth: [] }],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Verification toggled' },
          404: { description: 'Listing not found' },
        },
      },
    },
    '/api/admin/listings/{id}/status': {
      put: {
        tags: ['Admin'],
        summary: 'Set listing status (active / inactive / deleted)',
        security: [{ bearerAuth: [] }],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: { type: 'string', enum: ['active', 'inactive', 'deleted'] },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Status updated' },
          404: { description: 'Listing not found' },
        },
      },
    },
    '/api/admin/users': {
      get: {
        tags: ['Admin'],
        summary: 'Get all users (paginated, searchable)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: 'query', name: 'role', schema: { type: 'string', enum: ['seeker', 'owner', 'admin'] } },
          { in: 'query', name: 'search', schema: { type: 'string' }, description: 'Search by name or email' },
          { in: 'query', name: 'page', schema: { type: 'integer', default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          200: { description: 'Paginated user list' },
          403: { description: 'Requires admin role' },
        },
      },
    },
    '/api/admin/users/{id}/role': {
      put: {
        tags: ['Admin'],
        summary: 'Change a user\'s role (admin cannot demote themselves)',
        security: [{ bearerAuth: [] }],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['role'],
                properties: {
                  role: { type: 'string', enum: ['seeker', 'owner', 'admin'] },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Role updated' },
          403: { description: 'Cannot demote self' },
          404: { description: 'User not found' },
        },
      },
    },

    // ─── Health ──────────────────────────────────────────────────────────────
    '/api/health': {
      get: {
        tags: [],
        summary: 'Health check',
        responses: { 200: { description: 'API is running' } },
      },
    },
  },
};

module.exports = swaggerSpec;
