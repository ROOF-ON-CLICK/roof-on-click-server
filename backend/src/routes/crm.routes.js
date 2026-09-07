const express = require('express');
const { verifyToken, requireRole } = require('../middleware/auth.middleware');
const {
  getPortfolioOverview,
  getInventory,
  addOrUpdateRoom,
  getTenants,
  addTenant,
  updateTenant,
  deleteTenant,
  getLedger,
  recordPayment,
  getFinancialAnalytics,
} = require('../controllers/crm.controller');

const router = express.Router();

// All CRM routes are restricted to authenticated owners and admins
router.use(verifyToken, requireRole('owner', 'admin'));

// Portfolio & Overview
router.get('/overview', getPortfolioOverview);

// Room & Bed Inventory
router.get('/inventory', getInventory);
router.post('/rooms', addOrUpdateRoom);

// Tenant Directory & Operations
router.get('/tenants', getTenants);
router.post('/tenants', addTenant);
router.put('/tenants/:id', updateTenant);
router.delete('/tenants/:id', deleteTenant);

// Rent Ledger & Payment Logs
router.get('/ledger', getLedger);
router.post('/payments', recordPayment);

// Financial Analytics
router.get('/analytics', getFinancialAnalytics);

module.exports = router;
