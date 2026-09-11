const express = require('express');
const { verifyToken, requireRole } = require('../middleware/auth.middleware');
const {
  getPortfolioOverview,
  getInventory,
  addOrUpdateRoom,
  getTenants,
  getTenantById,
  addTenant,
  updateTenant,
  deleteTenant,
  downloadTenantTemplate,
  bulkAddTenants,
  getLedger,
  recordPayment,
  getPaymentHistory,
  getFinancialAnalytics,
} = require('../controllers/crm.controller');
const multer = require('multer');
const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

const router = express.Router();

// All CRM routes are restricted to authenticated owners and admins
router.use(verifyToken, requireRole('owner', 'admin'));

// Portfolio & Overview
router.get('/overview', getPortfolioOverview);

// Room & Bed Inventory
router.get('/inventory', getInventory);
router.post('/rooms', addOrUpdateRoom);

// Tenant Directory & Operations
router.get('/tenants/template', downloadTenantTemplate);
router.post('/tenants/bulk', uploadExcel.single('file'), bulkAddTenants);
router.get('/tenants', getTenants);
router.get('/tenants/:id', getTenantById);
router.post('/tenants', addTenant);
router.put('/tenants/:id', updateTenant);
router.delete('/tenants/:id', deleteTenant);

// Rent Ledger & Payment Logs
router.get('/ledger', getLedger);
router.get('/payments', getPaymentHistory);
router.post('/payments', recordPayment);

// Financial Analytics
router.get('/analytics', getFinancialAnalytics);

module.exports = router;
