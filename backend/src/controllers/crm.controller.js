const mongoose = require('mongoose');
const Tenant = require('../models/Tenant.model');
const RoomInventory = require('../models/RoomInventory.model');
const RentPayment = require('../models/RentPayment.model');
const Listing = require('../models/Listing.model');
const { success, error } = require('../utils/apiResponse');

// Helper: get current YYYY-MM
const getCurrentBillingMonth = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

// ─── GET /api/owner/crm/overview ─────────────────────────────────────────────
const getPortfolioOverview = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { propertyId, billingMonth = getCurrentBillingMonth() } = req.query;

    const propertyFilter = { owner: ownerId };
    if (propertyId && mongoose.Types.ObjectId.isValid(propertyId)) {
      propertyFilter._id = propertyId;
    }

    const properties = await Listing.find(propertyFilter).select('_id title address rent totalRooms availableRooms photos');
    const propertyIds = properties.map((p) => p._id);

    // Total rooms and beds from RoomInventory
    const roomFilter = { ownerId, propertyId: { $in: propertyIds } };
    const rooms = await RoomInventory.find(roomFilter);

    let totalBedsCount = 0;
    rooms.forEach((r) => {
      totalBedsCount += r.totalBeds || (r.beds ? r.beds.length : 1);
    });

    // Fallback: If no RoomInventory records exist yet, use properties' totalRooms
    if (totalBedsCount === 0) {
      properties.forEach((p) => {
        totalBedsCount += p.totalRooms || 1;
      });
    }

    // Active and Notice tenants
    const tenantFilter = { ownerId, propertyId: { $in: propertyIds } };
    const activeTenants = await Tenant.find({
      ...tenantFilter,
      status: { $in: ['Active', 'Notice'] },
    });

    const occupiedBeds = activeTenants.length;
    const noticeCount = activeTenants.filter((t) => t.status === 'Notice').length;
    const vacantBeds = Math.max(0, totalBedsCount - occupiedBeds);
    const occupancyRate = totalBedsCount > 0 ? Math.round((occupiedBeds / totalBedsCount) * 100) : 0;

    // Monthly Financials
    const expectedRent = activeTenants.reduce((sum, t) => sum + (t.monthlyRent || 0), 0);

    const paymentFilter = {
      ownerId,
      propertyId: { $in: propertyIds },
      billingMonth,
    };
    const payments = await RentPayment.find(paymentFilter);
    const collectedRent = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const pendingDues = Math.max(0, expectedRent - collectedRent);
    const collectionRate = expectedRent > 0 ? Math.min(100, Math.round((collectedRent / expectedRent) * 100)) : 0;

    return success(res, {
      message: 'Portfolio overview loaded successfully',
      data: {
        portfolio: {
          totalProperties: properties.length,
          totalBeds: totalBedsCount,
          occupiedBeds,
          vacantBeds,
          noticeCount,
          occupancyRate,
        },
        financials: {
          billingMonth,
          expectedRent,
          collectedRent,
          pendingDues,
          collectionRate,
        },
        properties: properties.map((p) => ({
          id: p._id,
          title: p.title,
          area: p.address?.area || p.address?.city || 'Indore',
          totalRooms: p.totalRooms,
          availableRooms: p.availableRooms,
          coverPhoto: p.photos?.[0]?.url || '',
        })),
      },
    });
  } catch (err) {
    console.error('getPortfolioOverview error:', err);
    return error(res, { message: 'Failed to load portfolio overview', error: err.message });
  }
};

// ─── GET /api/owner/crm/inventory ────────────────────────────────────────────
const getInventory = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { propertyId } = req.query;

    if (!propertyId || !mongoose.Types.ObjectId.isValid(propertyId)) {
      return error(res, { message: 'Valid propertyId is required', statusCode: 400 });
    }

    const listing = await Listing.findOne({ _id: propertyId, owner: ownerId }).select('title address totalRooms availableRooms');
    if (!listing) {
      return error(res, { message: 'Property not found or unauthorized', statusCode: 404 });
    }

    const rooms = await RoomInventory.find({ propertyId, ownerId }).sort({ floorNumber: 1, roomNumber: 1 });

    return success(res, {
      message: 'Room inventory retrieved',
      data: {
        property: {
          id: listing._id,
          title: listing.title,
          totalRooms: listing.totalRooms,
          availableRooms: listing.availableRooms,
        },
        rooms,
      },
    });
  } catch (err) {
    console.error('getInventory error:', err);
    return error(res, { message: 'Failed to load room inventory', error: err.message });
  }
};

const VALID_ROOM_TYPES = ['Single Room', 'Double Sharing', 'Triple Sharing', 'Four Sharing', 'Entire Flat', 'Studio'];

const normalizeRoomType = (raw, beds = 1) => {
  if (VALID_ROOM_TYPES.includes(raw)) return raw;
  const lower = String(raw || '').toLowerCase();
  if (lower.includes('studio')) return 'Studio';
  if (lower.includes('flat') || lower.includes('apartment')) return 'Entire Flat';
  if (lower.includes('four') || lower.includes('4')) return 'Four Sharing';
  if (lower.includes('triple') || lower.includes('3')) return 'Triple Sharing';
  if (lower.includes('double') || lower.includes('twin') || lower.includes('2')) return 'Double Sharing';
  if (lower.includes('single') || lower.includes('private') || lower.includes('1')) return 'Single Room';

  const num = Number(beds) || 1;
  if (num === 2) return 'Double Sharing';
  if (num === 3) return 'Triple Sharing';
  if (num >= 4) return 'Four Sharing';
  return 'Single Room';
};

// ─── POST /api/owner/crm/rooms ───────────────────────────────────────────────
const addOrUpdateRoom = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { propertyId, roomNumber, floorNumber = 1, roomType = 'Single Room', totalBeds = 1, baseMonthlyRent = 0, attachedBathroom = true } = req.body;

    if (!propertyId || !roomNumber) {
      return error(res, { message: 'propertyId and roomNumber are required', statusCode: 400 });
    }

    const cleanRoomType = normalizeRoomType(roomType, totalBeds);

    const listing = await Listing.findOne({ _id: propertyId, owner: ownerId });
    if (!listing) {
      return error(res, { message: 'Property not found or unauthorized', statusCode: 404 });
    }

    let room = await RoomInventory.findOne({ propertyId, roomNumber: String(roomNumber).trim() });

    if (room) {
      // Update existing room
      room.floorNumber = floorNumber;
      room.roomType = cleanRoomType;
      room.baseMonthlyRent = baseMonthlyRent;
      room.attachedBathroom = attachedBathroom;

      // Adjust beds array if totalBeds changed
      const currentBeds = room.beds || [];
      const newTotal = Number(totalBeds) || 1;
      if (newTotal > currentBeds.length) {
        for (let i = currentBeds.length; i < newTotal; i++) {
          currentBeds.push({
            label: `Bed ${i + 1}`,
            status: 'Vacant',
            occupiedBy: null,
            tenantName: '',
          });
        }
      } else if (newTotal < currentBeds.length) {
        // Only slice vacant beds from the end
        room.beds = currentBeds.slice(0, newTotal);
      }
      room.totalBeds = newTotal;
      await room.save();
    } else {
      // Create new room
      const beds = [];
      const numBeds = Number(totalBeds) || 1;
      for (let i = 0; i < numBeds; i++) {
        beds.push({
          label: `Bed ${i + 1}`,
          status: 'Vacant',
          occupiedBy: null,
          tenantName: '',
        });
      }

      room = await RoomInventory.create({
        propertyId,
        ownerId,
        floorNumber: Number(floorNumber) || 1,
        roomNumber: String(roomNumber).trim(),
        roomType: cleanRoomType,
        totalBeds: numBeds,
        baseMonthlyRent: Number(baseMonthlyRent) || 0,
        attachedBathroom,
        beds,
      });

      // Increment property totalRooms if needed
      await Listing.findByIdAndUpdate(propertyId, {
        $inc: { totalRooms: 1, availableRooms: 1 },
      });
    }

    return success(res, {
      message: 'Room inventory saved successfully',
      data: room,
      statusCode: 201,
    });
  } catch (err) {
    console.error('addOrUpdateRoom error:', err);
    return error(res, { message: 'Failed to save room inventory', error: err.message });
  }
};

// ─── GET /api/owner/crm/tenants ──────────────────────────────────────────────
const getTenants = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { propertyId, status, search } = req.query;

    const filter = { ownerId };
    if (propertyId && mongoose.Types.ObjectId.isValid(propertyId)) {
      filter.propertyId = propertyId;
    }
    if (status && ['Active', 'Notice', 'Moved Out'].includes(status)) {
      filter.status = status;
    }
    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      filter.$or = [{ name: regex }, { phone: regex }, { roomNumber: regex }];
    }

    const tenants = await Tenant.find(filter)
      .populate('propertyId', 'title address rent')
      .sort({ createdAt: -1 });

    return success(res, {
      message: 'Tenants retrieved successfully',
      data: tenants,
    });
  } catch (err) {
    console.error('getTenants error:', err);
    return error(res, { message: 'Failed to retrieve tenants', error: err.message });
  }
};

// ─── POST /api/owner/crm/tenants ─────────────────────────────────────────────
const addTenant = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const {
      propertyId,
      roomNumber,
      roomId,
      bedLabel = 'Bed 1',
      name,
      phone,
      email = '',
      emergencyContact,
      moveInDate = new Date(),
      monthlyRent,
      securityDeposit = 0,
      notes = '',
    } = req.body;

    if (!propertyId || !roomNumber || !name || !phone || monthlyRent === undefined) {
      return error(res, { message: 'Missing required tenant fields: propertyId, roomNumber, name, phone, monthlyRent', statusCode: 400 });
    }

    const listing = await Listing.findOne({ _id: propertyId, owner: ownerId });
    if (!listing) {
      return error(res, { message: 'Property not found or unauthorized', statusCode: 404 });
    }

    // Create Tenant
    const tenant = await Tenant.create({
      ownerId,
      propertyId,
      roomId,
      roomNumber: String(roomNumber).trim(),
      bedLabel,
      name: String(name).trim(),
      phone: String(phone).trim(),
      email: String(email).trim(),
      emergencyContact: emergencyContact || {},
      moveInDate,
      monthlyRent: Number(monthlyRent),
      securityDeposit: Number(securityDeposit) || 0,
      status: 'Active',
      notes,
    });

    // Mark bed in RoomInventory as Occupied if room inventory exists
    const room = await RoomInventory.findOne({ propertyId, roomNumber: String(roomNumber).trim() });
    if (room && room.beds && room.beds.length > 0) {
      const bed = room.beds.find((b) => b.label === bedLabel && b.status === 'Vacant') || room.beds.find((b) => b.status === 'Vacant') || room.beds[0];
      if (bed) {
        bed.status = 'Occupied';
        bed.occupiedBy = tenant._id;
        bed.tenantName = tenant.name;
        await room.save();
      }
    }

    // Synchronize marketplace listing availableRooms
    if (listing.availableRooms > 0) {
      listing.availableRooms = Math.max(0, listing.availableRooms - 1);
      await listing.save();
    }

    return success(res, {
      message: 'Rentee onboarded successfully',
      data: tenant,
      statusCode: 201,
    });
  } catch (err) {
    console.error('addTenant error:', err);
    return error(res, { message: 'Failed to add tenant', error: err.message });
  }
};

// ─── PUT /api/owner/crm/tenants/:id ──────────────────────────────────────────
const updateTenant = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { id } = req.params;
    const { status, noticeDate, expectedVacateDate, monthlyRent, roomNumber, bedLabel, emergencyContact, notes, name, phone, email } = req.body;

    const tenant = await Tenant.findOne({ _id: id, ownerId });
    if (!tenant) {
      return error(res, { message: 'Tenant not found or unauthorized', statusCode: 404 });
    }

    const previousStatus = tenant.status;

    if (name) tenant.name = name.trim();
    if (phone) tenant.phone = phone.trim();
    if (email !== undefined) tenant.email = email.trim();
    if (monthlyRent !== undefined) tenant.monthlyRent = Number(monthlyRent);
    if (roomNumber) tenant.roomNumber = String(roomNumber).trim();
    if (bedLabel) tenant.bedLabel = bedLabel;
    if (emergencyContact) tenant.emergencyContact = emergencyContact;
    if (notes !== undefined) tenant.notes = notes;

    // Handle status changes
    if (status && status !== previousStatus) {
      tenant.status = status;

      if (status === 'Notice') {
        tenant.noticeDate = noticeDate || new Date();
        tenant.expectedVacateDate = expectedVacateDate || null;

        // Update bed status in RoomInventory to Notice
        const room = await RoomInventory.findOne({ propertyId: tenant.propertyId, roomNumber: tenant.roomNumber });
        if (room && room.beds) {
          const bed = room.beds.find((b) => String(b.occupiedBy) === String(tenant._id));
          if (bed) {
            bed.status = 'Notice';
            await room.save();
          }
        }
      } else if (status === 'Moved Out') {
        tenant.moveOutDate = new Date();

        // Free up bed in RoomInventory
        const room = await RoomInventory.findOne({ propertyId: tenant.propertyId, roomNumber: tenant.roomNumber });
        if (room && room.beds) {
          const bed = room.beds.find((b) => String(b.occupiedBy) === String(tenant._id));
          if (bed) {
            bed.status = 'Vacant';
            bed.occupiedBy = null;
            bed.tenantName = '';
            await room.save();
          }
        }

        // Increment public listing availableRooms
        const listing = await Listing.findById(tenant.propertyId);
        if (listing) {
          listing.availableRooms = Math.min(listing.totalRooms || 999, (listing.availableRooms || 0) + 1);
          await listing.save();
        }
      } else if (status === 'Active' && previousStatus === 'Notice') {
        tenant.noticeDate = null;
        tenant.expectedVacateDate = null;

        const room = await RoomInventory.findOne({ propertyId: tenant.propertyId, roomNumber: tenant.roomNumber });
        if (room && room.beds) {
          const bed = room.beds.find((b) => String(b.occupiedBy) === String(tenant._id));
          if (bed) {
            bed.status = 'Occupied';
            await room.save();
          }
        }
      }
    }

    await tenant.save();

    return success(res, {
      message: 'Tenant details updated successfully',
      data: tenant,
    });
  } catch (err) {
    console.error('updateTenant error:', err);
    return error(res, { message: 'Failed to update tenant', error: err.message });
  }
};

// ─── DELETE /api/owner/crm/tenants/:id ───────────────────────────────────────
const deleteTenant = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { id } = req.params;

    const tenant = await Tenant.findOne({ _id: id, ownerId });
    if (!tenant) {
      return error(res, { message: 'Tenant not found or unauthorized', statusCode: 404 });
    }

    // If tenant was active or in notice, free up bed and restore availableRooms
    if (tenant.status !== 'Moved Out') {
      const room = await RoomInventory.findOne({ propertyId: tenant.propertyId, roomNumber: tenant.roomNumber });
      if (room && room.beds) {
        const bed = room.beds.find((b) => String(b.occupiedBy) === String(tenant._id));
        if (bed) {
          bed.status = 'Vacant';
          bed.occupiedBy = null;
          bed.tenantName = '';
          await room.save();
        }
      }

      const listing = await Listing.findById(tenant.propertyId);
      if (listing) {
        listing.availableRooms = Math.min(listing.totalRooms || 999, (listing.availableRooms || 0) + 1);
        await listing.save();
      }
    }

    await Tenant.findByIdAndDelete(id);

    return success(res, { message: 'Tenant record removed successfully' });
  } catch (err) {
    console.error('deleteTenant error:', err);
    return error(res, { message: 'Failed to remove tenant', error: err.message });
  }
};

// ─── GET /api/owner/crm/ledger ───────────────────────────────────────────────
const getLedger = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { propertyId, billingMonth = getCurrentBillingMonth() } = req.query;

    const propertyFilter = { owner: ownerId };
    if (propertyId && mongoose.Types.ObjectId.isValid(propertyId)) {
      propertyFilter._id = propertyId;
    }
    const properties = await Listing.find(propertyFilter).select('_id title');
    const propertyIds = properties.map((p) => p._id);

    // Active tenants for these properties
    const tenants = await Tenant.find({
      ownerId,
      propertyId: { $in: propertyIds },
      status: { $in: ['Active', 'Notice'] },
    }).populate('propertyId', 'title');

    // Payments recorded for this billingMonth
    const payments = await RentPayment.find({
      ownerId,
      propertyId: { $in: propertyIds },
      billingMonth,
    }).sort({ paymentDate: -1 });

    // Build ledger matrix
    const ledger = tenants.map((tenant) => {
      const tenantPayments = payments.filter((p) => String(p.tenantId) === String(tenant._id));
      const totalPaid = tenantPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
      const monthlyRent = tenant.monthlyRent || 0;
      const balanceDue = Math.max(0, monthlyRent - totalPaid);

      let status = 'Pending';
      if (totalPaid >= monthlyRent && monthlyRent > 0) {
        status = 'Paid';
      } else if (totalPaid > 0) {
        status = 'Partial';
      }

      return {
        tenantId: tenant._id,
        tenantName: tenant.name,
        tenantPhone: tenant.phone,
        propertyId: tenant.propertyId?._id,
        propertyTitle: tenant.propertyId?.title || 'Unknown',
        roomNumber: tenant.roomNumber,
        bedLabel: tenant.bedLabel,
        monthlyRent,
        totalPaid,
        balanceDue,
        status,
        payments: tenantPayments,
      };
    });

    const totalExpected = ledger.reduce((sum, l) => sum + l.monthlyRent, 0);
    const totalCollected = ledger.reduce((sum, l) => sum + l.totalPaid, 0);
    const totalPending = Math.max(0, totalExpected - totalCollected);

    return success(res, {
      message: 'Ledger retrieved successfully',
      data: {
        billingMonth,
        summary: {
          totalExpected,
          totalCollected,
          totalPending,
          paidCount: ledger.filter((l) => l.status === 'Paid').length,
          partialCount: ledger.filter((l) => l.status === 'Partial').length,
          pendingCount: ledger.filter((l) => l.status === 'Pending').length,
        },
        ledger,
      },
    });
  } catch (err) {
    console.error('getLedger error:', err);
    return error(res, { message: 'Failed to retrieve ledger', error: err.message });
  }
};

// ─── POST /api/owner/crm/payments ───────────────────────────────────────────
const recordPayment = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { tenantId, propertyId, billingMonth = getCurrentBillingMonth(), amount, paymentDate = new Date(), paymentMode = 'UPI', referenceNumber = '', notes = '' } = req.body;

    if (!tenantId || !amount || Number(amount) <= 0) {
      return error(res, { message: 'tenantId and positive amount are required', statusCode: 400 });
    }

    const tenant = await Tenant.findOne({ _id: tenantId, ownerId });
    if (!tenant) {
      return error(res, { message: 'Tenant not found or unauthorized', statusCode: 404 });
    }

    const payment = await RentPayment.create({
      ownerId,
      propertyId: propertyId || tenant.propertyId,
      tenantId: tenant._id,
      tenantName: tenant.name,
      roomNumber: tenant.roomNumber,
      billingMonth,
      amount: Number(amount),
      paymentDate,
      paymentMode,
      referenceNumber,
      notes,
      status: 'Paid',
    });

    return success(res, {
      message: 'Rent payment recorded successfully',
      data: payment,
      statusCode: 201,
    });
  } catch (err) {
    console.error('recordPayment error:', err);
    return error(res, { message: 'Failed to record payment', error: err.message });
  }
};

// ─── GET /api/owner/crm/analytics ───────────────────────────────────────────
const getFinancialAnalytics = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { propertyId } = req.query;

    const propertyFilter = { owner: ownerId };
    if (propertyId && mongoose.Types.ObjectId.isValid(propertyId)) {
      propertyFilter._id = propertyId;
    }
    const properties = await Listing.find(propertyFilter).select('_id');
    const propertyIds = properties.map((p) => p._id);

    // Compute last 6 months trend
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push(ym);
    }

    const payments = await RentPayment.find({
      ownerId,
      propertyId: { $in: propertyIds },
      billingMonth: { $in: months },
    });

    // Active tenants for baseline monthly expected rent
    const activeTenants = await Tenant.find({
      ownerId,
      propertyId: { $in: propertyIds },
      status: { $in: ['Active', 'Notice'] },
    });
    const baseExpected = activeTenants.reduce((sum, t) => sum + (t.monthlyRent || 0), 0);

    const monthlyTrend = months.map((month) => {
      const monthPayments = payments.filter((p) => p.billingMonth === month);
      const collected = monthPayments.reduce((sum, p) => sum + p.amount, 0);
      return {
        month,
        expected: baseExpected,
        collected,
      };
    });

    // Payment mode breakdown
    const modeCounts = {
      UPI: 0,
      Cash: 0,
      'Bank Transfer': 0,
      Cheque: 0,
      Other: 0,
    };
    payments.forEach((p) => {
      const mode = p.paymentMode || 'UPI';
      if (modeCounts[mode] !== undefined) {
        modeCounts[mode] += p.amount;
      } else {
        modeCounts.Other += p.amount;
      }
    });

    return success(res, {
      message: 'Financial analytics retrieved',
      data: {
        monthlyTrend,
        paymentModes: Object.entries(modeCounts).map(([mode, amount]) => ({ mode, amount })),
      },
    });
  } catch (err) {
    console.error('getFinancialAnalytics error:', err);
    return error(res, { message: 'Failed to retrieve analytics', error: err.message });
  }
};

module.exports = {
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
};
