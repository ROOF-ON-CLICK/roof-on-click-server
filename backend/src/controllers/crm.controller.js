const mongoose = require('mongoose');
const XLSX = require('xlsx');
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
    const totalSecurityDeposit = activeTenants.reduce((sum, t) => sum + (t.securityDeposit || 0), 0);

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
          totalSecurityDeposit,
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
      const occupiedCount = currentBeds.filter((b) => b.status === 'Occupied' || b.status === 'Notice').length;
      if (newTotal < occupiedCount) {
        return error(res, {
          message: `Cannot reduce total beds to ${newTotal} because ${occupiedCount} bed(s) are currently occupied or on notice.`,
          statusCode: 400,
        });
      }

      if (newTotal > currentBeds.length) {
        for (let i = currentBeds.length; i < newTotal; i++) {
          currentBeds.push({
            label: `Bed ${i + 1}`,
            status: 'Vacant',
            occupiedBy: null,
            tenantName: '',
          });
        }
        room.beds = currentBeds;
      } else if (newTotal < currentBeds.length) {
        // Remove only vacant beds from the end
        const kept = [];
        let toRemove = currentBeds.length - newTotal;
        for (let i = currentBeds.length - 1; i >= 0; i--) {
          if (toRemove > 0 && currentBeds[i].status === 'Vacant') {
            toRemove--;
          } else {
            kept.unshift(currentBeds[i]);
          }
        }
        room.beds = kept;
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
      avatar = '',
      documents = [],
    } = req.body;

    if (!propertyId || !roomNumber || !name || !phone || monthlyRent === undefined) {
      return error(res, { message: 'Missing required tenant fields: propertyId, roomNumber, name, phone, monthlyRent', statusCode: 400 });
    }

    const listing = await Listing.findOne({ _id: propertyId, owner: ownerId });
    if (!listing) {
      return error(res, { message: 'Property not found or unauthorized', statusCode: 404 });
    }

    // Verify room inventory and bed availability
    const room = await RoomInventory.findOne({ propertyId, roomNumber: String(roomNumber).trim() });
    let chosenBed = null;
    if (room && room.beds && room.beds.length > 0) {
      if (bedLabel) {
        const targetBed = room.beds.find((b) => b.label === bedLabel);
        if (targetBed) {
          if (targetBed.status !== 'Vacant') {
            return error(res, {
              message: `${bedLabel} in Room ${roomNumber} is already occupied${targetBed.tenantName ? ` by ${targetBed.tenantName}` : ''}. Please select a vacant bed.`,
              statusCode: 400,
            });
          }
          chosenBed = targetBed;
        }
      }

      if (!chosenBed) {
        chosenBed = room.beds.find((b) => b.status === 'Vacant');
      }

      if (!chosenBed) {
        return error(res, {
          message: `Room ${roomNumber} has no vacant beds available.`,
          statusCode: 400,
        });
      }
    }

    const assignedBedLabel = chosenBed ? chosenBed.label : (bedLabel || 'Bed 1');

    // Create Tenant
    const tenant = await Tenant.create({
      ownerId,
      propertyId,
      roomId: room ? room._id : roomId,
      roomNumber: String(roomNumber).trim(),
      bedLabel: assignedBedLabel,
      name: String(name).trim(),
      phone: String(phone).trim(),
      email: String(email).trim(),
      emergencyContact: emergencyContact || {},
      moveInDate,
      monthlyRent: Number(monthlyRent),
      securityDeposit: Number(securityDeposit) || 0,
      status: 'Active',
      notes,
      avatar: avatar || '',
      documents: Array.isArray(documents) ? documents : [],
    });

    // Mark bed in RoomInventory as Occupied if room inventory exists
    if (room && chosenBed) {
      chosenBed.status = 'Occupied';
      chosenBed.occupiedBy = tenant._id;
      chosenBed.tenantName = tenant.name;
      await room.save();
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
    const { status, noticeDate, expectedVacateDate, moveInDate, monthlyRent, securityDeposit, roomNumber, bedLabel, emergencyContact, notes, name, phone, email, avatar, documents } = req.body;

    const tenant = await Tenant.findOne({ _id: id, ownerId });
    if (!tenant) {
      return error(res, { message: 'Tenant not found or unauthorized', statusCode: 404 });
    }

    const previousStatus = tenant.status;

    const oldRoomNumber = tenant.roomNumber;
    const oldBedLabel = tenant.bedLabel;
    const targetRoomNumber = roomNumber ? String(roomNumber).trim() : oldRoomNumber;
    const targetBedLabel = bedLabel || oldBedLabel;
    const isRoomOrBedChanged = (roomNumber && targetRoomNumber !== oldRoomNumber) || (bedLabel && targetBedLabel !== oldBedLabel);

    if (isRoomOrBedChanged && tenant.status !== 'Moved Out') {
      const targetRoom = await RoomInventory.findOne({ propertyId: tenant.propertyId, roomNumber: targetRoomNumber });
      if (targetRoom && targetRoom.beds && targetRoom.beds.length > 0) {
        const destBed = targetRoom.beds.find((b) => b.label === targetBedLabel);
        if (destBed && destBed.status !== 'Vacant' && String(destBed.occupiedBy) !== String(tenant._id)) {
          return error(res, {
            message: `${targetBedLabel} in Room ${targetRoomNumber} is already occupied.`,
            statusCode: 400,
          });
        }
        // Vacate old bed
        const oldRoom = await RoomInventory.findOne({ propertyId: tenant.propertyId, roomNumber: oldRoomNumber });
        if (oldRoom && oldRoom.beds) {
          const prevBed = oldRoom.beds.find((b) => String(b.occupiedBy) === String(tenant._id));
          if (prevBed) {
            prevBed.status = 'Vacant';
            prevBed.occupiedBy = null;
            prevBed.tenantName = '';
            await oldRoom.save();
          }
        }
        // Occupy new bed
        if (destBed) {
          destBed.status = (status || tenant.status) === 'Notice' ? 'Notice' : 'Occupied';
          destBed.occupiedBy = tenant._id;
          destBed.tenantName = name ? name.trim() : tenant.name;
          await targetRoom.save();
        }
      }
    }

    if (name) tenant.name = name.trim();
    if (phone) tenant.phone = phone.trim();
    if (email !== undefined) tenant.email = email.trim();
    if (avatar !== undefined) tenant.avatar = avatar;
    if (documents !== undefined && Array.isArray(documents)) tenant.documents = documents;
    if (monthlyRent !== undefined) tenant.monthlyRent = Number(monthlyRent);
    if (securityDeposit !== undefined) tenant.securityDeposit = Number(securityDeposit);
    if (moveInDate !== undefined) tenant.moveInDate = moveInDate;
    if (roomNumber) tenant.roomNumber = targetRoomNumber;
    if (bedLabel) tenant.bedLabel = targetBedLabel;
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
        securityDeposit: tenant.securityDeposit || 0,
        totalPaid,
        balanceDue,
        status,
        payments: tenantPayments,
      };
    });

    const totalExpected = ledger.reduce((sum, l) => sum + l.monthlyRent, 0);
    const totalCollected = ledger.reduce((sum, l) => sum + l.totalPaid, 0);
    const totalPending = Math.max(0, totalExpected - totalCollected);
    const totalSecurityDeposit = ledger.reduce((sum, l) => sum + (l.securityDeposit || 0), 0);

    return success(res, {
      message: 'Ledger retrieved successfully',
      data: {
        billingMonth,
        summary: {
          totalExpected,
          totalCollected,
          totalPending,
          totalSecurityDeposit,
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

    // Compute monthly trend based on requested range (3, 6, 12 months, or 'ytd')
    const rangeParam = String(req.query.range || req.query.months || '6').toLowerCase();
    const months = [];
    const now = new Date();

    if (rangeParam === 'ytd') {
      const currentMonthIdx = now.getMonth();
      for (let i = currentMonthIdx; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        months.push(ym);
      }
    } else {
      const monthsCount = Math.min(Math.max(parseInt(rangeParam, 10) || 6, 1), 36);
      for (let i = monthsCount - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        months.push(ym);
      }
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

// ─── GET /api/owner/crm/payments ────────────────────────────────────────────
const getPaymentHistory = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { propertyId, tenantId, billingMonth, paymentMode, search } = req.query;

    const filter = { ownerId };

    if (propertyId && propertyId !== 'ALL' && mongoose.Types.ObjectId.isValid(propertyId)) {
      filter.propertyId = propertyId;
    }
    if (tenantId && mongoose.Types.ObjectId.isValid(tenantId)) {
      filter.tenantId = tenantId;
    }
    if (billingMonth && billingMonth !== 'ALL') {
      filter.billingMonth = billingMonth;
    }
    if (paymentMode && paymentMode !== 'ALL') {
      filter.paymentMode = paymentMode;
    }
    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { tenantName: regex },
        { roomNumber: regex },
        { referenceNumber: regex },
        { notes: regex },
      ];
    }

    const payments = await RentPayment.find(filter)
      .populate('propertyId', 'title')
      .sort({ paymentDate: -1, createdAt: -1 });

    const totalAmount = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

    return success(res, {
      message: 'Payment history retrieved successfully',
      data: {
        totalAmount,
        count: payments.length,
        payments,
      },
    });
  } catch (err) {
    console.error('getPaymentHistory error:', err);
    return error(res, { message: 'Failed to retrieve payment history', error: err.message });
  }
};

// ─── GET /api/owner/crm/tenants/:id ──────────────────────────────────────────
const getTenantById = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { id } = req.params;

    const tenant = await Tenant.findOne({ _id: id, ownerId }).populate('propertyId', 'title address city area images');
    if (!tenant) {
      return error(res, { message: 'Tenant not found or unauthorized', statusCode: 404 });
    }

    // Fetch tenant payments
    const payments = await RentPayment.find({ tenantId: tenant._id, ownerId }).sort({ paymentDate: -1, createdAt: -1 });
    const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

    return success(res, {
      message: 'Tenant details retrieved successfully',
      data: {
        tenant,
        payments,
        totalPaid,
      },
    });
  } catch (err) {
    console.error('getTenantById error:', err);
    return error(res, { message: 'Failed to retrieve tenant details', error: err.message });
  }
};

// ─── GET /api/owner/crm/tenants/template ─────────────────────────────────────
const downloadTenantTemplate = async (req, res) => {
  try {
    const { format = 'xlsx' } = req.query;

    // Sheet 1: Sample & Pre-configured Data
    const templateData = [
      {
        'Full Name': 'Rahul Sharma',
        'Phone Number': '9876543210',
        'Email': 'rahul.sharma@example.com',
        'Room Number': '101',
        'Bed Label': 'Bed 1',
        'Monthly Rent': 8500,
        'Security Deposit': 5000,
        'Move In Date': '2026-09-01',
        'Emergency Name': 'Suresh Sharma',
        'Emergency Phone': '9811122233',
        'Emergency Relation': 'Father',
        'Notes': 'College student at DAVV',
      },
      {
        'Full Name': 'Aman Verma',
        'Phone Number': '9812345678',
        'Email': 'aman.verma@example.com',
        'Room Number': '101',
        'Bed Label': 'Bed 2',
        'Monthly Rent': 8500,
        'Security Deposit': 5000,
        'Move In Date': '2026-09-05',
        'Emergency Name': 'Kailash Verma',
        'Emergency Phone': '9822233344',
        'Emergency Relation': 'Father',
        'Notes': 'Working professional',
      },
      {
        'Full Name': 'Pooja Patel',
        'Phone Number': '9988776655',
        'Email': 'pooja.p@example.com',
        'Room Number': '102',
        'Bed Label': 'Bed 1',
        'Monthly Rent': 12000,
        'Security Deposit': 10000,
        'Move In Date': '2026-09-10',
        'Emergency Name': 'Meena Patel',
        'Emergency Phone': '9876501234',
        'Emergency Relation': 'Mother',
        'Notes': 'Single occupancy room',
      },
    ];

    // Sheet 2: Guidelines & Instructions
    const instructionData = [
      {
        'Field Name': 'Full Name',
        'Required': 'YES',
        'Rules & Format': 'Full legal name of the rentee. Minimum 2 characters.',
        'Example': 'Rahul Sharma',
      },
      {
        'Field Name': 'Phone Number',
        'Required': 'YES',
        'Rules & Format': '10-digit Indian mobile number. Do not include +91 or spaces. Must be unique per rentee.',
        'Example': '9876543210',
      },
      {
        'Field Name': 'Email',
        'Required': 'NO',
        'Rules & Format': 'Valid email address. Optional.',
        'Example': 'rahul.sharma@example.com',
      },
      {
        'Field Name': 'Room Number',
        'Required': 'YES',
        'Rules & Format': 'Room number matching your property layout. E.g., 101, 102, G-01.',
        'Example': '101',
      },
      {
        'Field Name': 'Bed Label',
        'Required': 'YES (STRICT)',
        'Rules & Format': 'Identification label for the bed (e.g., Bed 1, Bed 2). FOR SINGLE OCCUPANCY / 1-BED ROOMS, YOU MUST STILL ENTER "Bed 1".',
        'Example': 'Bed 1',
      },
      {
        'Field Name': 'Monthly Rent',
        'Required': 'YES',
        'Rules & Format': 'Agreed monthly rent amount in INR as a positive number. Do not add currency signs or commas.',
        'Example': '8500',
      },
      {
        'Field Name': 'Security Deposit',
        'Required': 'NO',
        'Rules & Format': 'Deposit amount paid in INR. Defaults to 0 if empty.',
        'Example': '5000',
      },
      {
        'Field Name': 'Move In Date',
        'Required': 'NO',
        'Rules & Format': 'Date of onboarding. Format: YYYY-MM-DD or DD-MM-YYYY. Defaults to today if omitted.',
        'Example': '2026-09-01',
      },
      {
        'Field Name': 'Emergency Name',
        'Required': 'NO',
        'Rules & Format': 'Name of emergency contact person.',
        'Example': 'Suresh Sharma',
      },
      {
        'Field Name': 'Emergency Phone',
        'Required': 'NO',
        'Rules & Format': '10-digit phone number of emergency contact.',
        'Example': '9811122233',
      },
      {
        'Field Name': 'Emergency Relation',
        'Required': 'NO',
        'Rules & Format': 'Relationship (e.g., Father, Mother, Guardian, Friend).',
        'Example': 'Father',
      },
      {
        'Field Name': 'Notes',
        'Required': 'NO',
        'Rules & Format': 'Any special notes, organization name, or additional remarks.',
        'Example': 'College student at DAVV',
      },
    ];

    const wb = XLSX.utils.book_new();

    const wsTenants = XLSX.utils.json_to_sheet(templateData);
    wsTenants['!cols'] = [
      { wch: 20 }, // Full Name
      { wch: 15 }, // Phone Number
      { wch: 26 }, // Email
      { wch: 14 }, // Room Number
      { wch: 14 }, // Bed Label
      { wch: 14 }, // Monthly Rent
      { wch: 16 }, // Security Deposit
      { wch: 14 }, // Move In Date
      { wch: 20 }, // Emergency Name
      { wch: 16 }, // Emergency Phone
      { wch: 18 }, // Emergency Relation
      { wch: 28 }, // Notes
    ];

    const wsInstructions = XLSX.utils.json_to_sheet(instructionData);
    wsInstructions['!cols'] = [
      { wch: 20 }, // Field Name
      { wch: 16 }, // Required
      { wch: 60 }, // Rules & Format
      { wch: 25 }, // Example
    ];

    XLSX.utils.book_append_sheet(wb, wsTenants, 'Tenants');
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions & Rules');

    if (String(format).toLowerCase() === 'csv') {
      const csvContent = XLSX.utils.sheet_to_csv(wsTenants);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="rentees_upload_template.csv"');
      return res.status(200).send(csvContent);
    }

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="rentees_upload_template.xlsx"');
    return res.status(200).send(buffer);
  } catch (err) {
    console.error('downloadTenantTemplate error:', err);
    return error(res, { message: 'Failed to generate spreadsheet template', error: err.message });
  }
};

// ─── POST /api/owner/crm/tenants/bulk ─────────────────────────────────────────
const bulkAddTenants = async (req, res) => {
  try {
    const ownerId = req.user._id;
    let { propertyId, tenants, autoProvision = false } = req.body;

    // Handle file upload if multipart/form-data with file was submitted
    if (req.file) {
      try {
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
        tenants = rawRows;
      } catch (parseErr) {
        return error(res, { message: 'Failed to read spreadsheet file. Please check format.', statusCode: 400 });
      }
    }

    if (!propertyId || !mongoose.Types.ObjectId.isValid(propertyId)) {
      return error(res, { message: 'A valid propertyId is required', statusCode: 400 });
    }

    if (!Array.isArray(tenants) || tenants.length === 0) {
      return error(res, { message: 'No rentee records provided for bulk import', statusCode: 400 });
    }

    const listing = await Listing.findOne({ _id: propertyId, owner: ownerId });
    if (!listing) {
      return error(res, { message: 'Property not found or unauthorized', statusCode: 404 });
    }

    // Load existing active tenants under this property to check phone collisions
    const existingTenants = await Tenant.find({ propertyId, status: { $in: ['Active', 'Notice'] } }).select('phone roomNumber bedLabel');
    const existingPhones = new Set(existingTenants.map((t) => String(t.phone).trim()));

    // Load current room inventory
    const rooms = await RoomInventory.find({ propertyId });
    const roomMap = new Map();
    rooms.forEach((r) => {
      roomMap.set(String(r.roomNumber).trim(), r);
    });

    const successRows = [];
    const failedRows = [];
    const batchPhonesInPayload = new Set();
    const batchBedKeysInPayload = new Set();

    for (let index = 0; index < tenants.length; index++) {
      const raw = tenants[index];
      const rowNum = index + 2; // Row 1 is header in spreadsheets

      // Normalize field names (support both Excel headers and JSON keys)
      const name = String(raw['Full Name'] || raw.name || '').trim();
      let phone = String(raw['Phone Number'] || raw.phone || '').trim().replace(/\D/g, '');
      if (phone.length > 10 && phone.startsWith('91')) {
        phone = phone.slice(2);
      }
      const email = String(raw['Email'] || raw.email || '').trim();
      const roomNumber = String(raw['Room Number'] || raw.roomNumber || '').trim();
      const rawBedLabel = String(raw['Bed Label'] || raw.bedLabel || '').trim();
      const monthlyRent = Number(raw['Monthly Rent'] !== undefined ? raw['Monthly Rent'] : raw.monthlyRent);
      const securityDeposit = Number(raw['Security Deposit'] !== undefined ? raw['Security Deposit'] : (raw.securityDeposit || 0)) || 0;
      
      let moveInDate = raw['Move In Date'] || raw.moveInDate;
      let parsedDate = new Date();
      if (moveInDate) {
        if (typeof moveInDate === 'number') {
          // Excel date serial number conversion
          parsedDate = new Date(Math.round((moveInDate - 25569) * 86400 * 1000));
        } else {
          // Check DD-MM-YYYY or DD/MM/YYYY
          const dmyMatch = String(moveInDate).match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
          if (dmyMatch) {
            parsedDate = new Date(Number(dmyMatch[3]), Number(dmyMatch[2]) - 1, Number(dmyMatch[1]));
          } else {
            const parsed = new Date(moveInDate);
            if (!isNaN(parsed.getTime())) parsedDate = parsed;
          }
        }
      }

      const emergencyName = String(raw['Emergency Name'] || raw.emergencyName || (raw.emergencyContact && raw.emergencyContact.name) || '').trim();
      const emergencyPhone = String(raw['Emergency Phone'] || raw.emergencyPhone || (raw.emergencyContact && raw.emergencyContact.phone) || '').trim();
      const emergencyRelation = String(raw['Emergency Relation'] || raw.emergencyRelation || (raw.emergencyContact && raw.emergencyContact.relation) || '').trim();
      const notes = String(raw['Notes'] || raw.notes || '').trim();

      // Field Validations
      if (!name) {
        failedRows.push({ row: rowNum, name: name || 'Unnamed', reason: 'Full Name is required' });
        continue;
      }

      if (!phone || phone.length < 10) {
        failedRows.push({ row: rowNum, name, reason: `Invalid phone number: '${raw['Phone Number'] || raw.phone || ''}'. Must be a 10-digit number.` });
        continue;
      }

      if (isNaN(monthlyRent) || monthlyRent < 0) {
        failedRows.push({ row: rowNum, name, reason: 'Monthly Rent must be a positive number' });
        continue;
      }

      if (!roomNumber) {
        failedRows.push({ row: rowNum, name, reason: 'Room Number is required' });
        continue;
      }

      // Mandatory Bed Label Validation: Even for single-bed rooms, Bed Label is required
      if (!rawBedLabel) {
        failedRows.push({
          row: rowNum,
          name,
          reason: 'Bed Label is required. For single occupancy rooms, enter "Bed 1".',
        });
        continue;
      }

      // Normalize Bed Label (e.g. "bed 1" -> "Bed 1", "1" -> "Bed 1")
      let normalizedBedLabel = rawBedLabel;
      if (/^\d+$/.test(rawBedLabel)) {
        normalizedBedLabel = `Bed ${rawBedLabel}`;
      } else if (/^bed\s*\d+$/i.test(rawBedLabel)) {
        const numPart = rawBedLabel.replace(/\D/g, '');
        normalizedBedLabel = `Bed ${numPart}`;
      }

      // Duplicate phone check against existing active tenants (Option A: skip with duplicate error)
      if (existingPhones.has(phone)) {
        failedRows.push({ row: rowNum, name, reason: `Phone number ${phone} is already registered to an active rentee in this property` });
        continue;
      }

      // Duplicate phone check within current batch
      if (batchPhonesInPayload.has(phone)) {
        failedRows.push({ row: rowNum, name, reason: `Duplicate phone number ${phone} appears multiple times in the upload` });
        continue;
      }

      // Double-booking check within current batch
      const batchBedKey = `${roomNumber}::${normalizedBedLabel}`.toLowerCase();
      if (batchBedKeysInPayload.has(batchBedKey)) {
        failedRows.push({ row: rowNum, name, reason: `Room ${roomNumber} - ${normalizedBedLabel} is assigned more than once in this batch` });
        continue;
      }

      // Room & Bed availability check in database
      let targetRoom = roomMap.get(roomNumber);

      if (!targetRoom) {
        if (!autoProvision) {
          failedRows.push({
            row: rowNum,
            name,
            reason: `Room ${roomNumber} does not exist in property inventory. Enable 'Auto-provision missing rooms' or add room first.`,
          });
          continue;
        }

        // Auto-provision room
        const beds = [
          {
            label: normalizedBedLabel,
            status: 'Vacant',
            occupiedBy: null,
            tenantName: '',
          },
        ];

        targetRoom = await RoomInventory.create({
          propertyId,
          ownerId,
          floorNumber: 1,
          roomNumber,
          roomType: 'Single Room',
          totalBeds: 1,
          baseMonthlyRent: monthlyRent || 0,
          attachedBathroom: true,
          beds,
        });

        roomMap.set(roomNumber, targetRoom);
      }

      // Check if bed exists in targetRoom
      let targetBed = targetRoom.beds.find((b) => b.label.toLowerCase() === normalizedBedLabel.toLowerCase());

      if (!targetBed) {
        if (autoProvision) {
          // Add this bed to the room
          targetRoom.beds.push({
            label: normalizedBedLabel,
            status: 'Vacant',
            occupiedBy: null,
            tenantName: '',
          });
          targetRoom.totalBeds = targetRoom.beds.length;
          targetBed = targetRoom.beds[targetRoom.beds.length - 1];
        } else {
          failedRows.push({
            row: rowNum,
            name,
            reason: `${normalizedBedLabel} does not exist in Room ${roomNumber}. Available beds: ${targetRoom.beds.map((b) => b.label).join(', ') || 'None'}`,
          });
          continue;
        }
      }

      if (targetBed.status !== 'Vacant') {
        failedRows.push({
          row: rowNum,
          name,
          reason: `${normalizedBedLabel} in Room ${roomNumber} is already ${targetBed.status}${targetBed.tenantName ? ` (${targetBed.tenantName})` : ''}`,
        });
        continue;
      }

      // Validated. Create tenant record
      try {
        const createdTenant = await Tenant.create({
          ownerId,
          propertyId,
          roomId: targetRoom._id,
          roomNumber,
          bedLabel: targetBed.label,
          name,
          phone,
          email,
          emergencyContact: {
            name: emergencyName,
            phone: emergencyPhone,
            relation: emergencyRelation,
          },
          moveInDate: parsedDate,
          monthlyRent,
          securityDeposit,
          status: 'Active',
          notes,
        });

        // Update bed status in memory and persist
        targetBed.status = 'Occupied';
        targetBed.occupiedBy = createdTenant._id;
        targetBed.tenantName = createdTenant.name;
        await targetRoom.save();

        // Mark phone and bed as used
        existingPhones.add(phone);
        batchPhonesInPayload.add(phone);
        batchBedKeysInPayload.add(batchBedKey);

        successRows.push({
          row: rowNum,
          tenantId: createdTenant._id,
          name: createdTenant.name,
          roomNumber: createdTenant.roomNumber,
          bedLabel: createdTenant.bedLabel,
          phone: createdTenant.phone,
        });
      } catch (createErr) {
        failedRows.push({ row: rowNum, name, reason: createErr.message || 'Database error creating tenant' });
      }
    }

    // Synchronize listing availableRooms & availableBeds
    if (successRows.length > 0) {
      if (listing.availableRooms > 0) {
        listing.availableRooms = Math.max(0, listing.availableRooms - successRows.length);
      }
      if (listing.availableBeds > 0) {
        listing.availableBeds = Math.max(0, listing.availableBeds - successRows.length);
      }
      await listing.save();
    }

    return success(res, {
      message: `Bulk import completed: ${successRows.length} rentee(s) added, ${failedRows.length} skipped or failed`,
      data: {
        totalRows: tenants.length,
        successCount: successRows.length,
        failedCount: failedRows.length,
        successRows,
        errors: failedRows,
      },
    });
  } catch (err) {
    console.error('bulkAddTenants error:', err);
    return error(res, { message: 'Failed to process bulk rentee upload', error: err.message });
  }
};

module.exports = {
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
};


