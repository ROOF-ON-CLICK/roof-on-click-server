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

// Resilient transaction executor (supports Atlas replica sets with standalone fallback)
const runInTransaction = async (workFn) => {
  let session = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    const result = await workFn(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    if (session) {
      try {
        await session.abortTransaction();
      } catch (_) {}
    }
    // Fallback if environment is a standalone non-replica MongoDB
    if (
      err.message &&
      (err.message.includes('replica set') ||
        err.message.includes('Transaction numbers are only allowed on a replica set') ||
        err.message.includes('Transactions are not supported'))
    ) {
      return await workFn(null);
    }
    throw err;
  } finally {
    if (session) {
      await session.endSession();
    }
  }
};

// ─── GET /api/owner/crm/overview ─────────────────────────────────────────────
const getPortfolioOverview = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { propertyId, billingMonth = getCurrentBillingMonth() } = req.query;

    // Only approved and published ('active') properties are manageable in CRM
    const propertyFilter = { owner: ownerId, status: 'active' };
    if (propertyId && mongoose.Types.ObjectId.isValid(propertyId)) {
      propertyFilter._id = propertyId;
    }

    const properties = await Listing.find(propertyFilter)
      .select('_id title address rent totalRooms availableRooms photos')
      .lean();

    const propertyIds = properties.map((p) => p._id);

    if (propertyIds.length === 0) {
      return success(res, {
        message: 'Portfolio overview loaded successfully',
        data: {
          portfolio: {
            totalProperties: 0,
            totalBeds: 0,
            occupiedBeds: 0,
            vacantBeds: 0,
            noticeCount: 0,
            occupancyRate: 0,
          },
          financials: {
            billingMonth,
            expectedRent: 0,
            collectedRent: 0,
            pendingDues: 0,
            collectionRate: 0,
            totalSecurityDeposit: 0,
          },
          properties: [],
        },
      });
    }

    const ownerObjId = new mongoose.Types.ObjectId(ownerId);

    // Concurrently execute database aggregations instead of in-memory reductions
    const [tenantStats, paymentStats, roomStats] = await Promise.all([
      // 1. Tenant aggregation: Occupancy, Notice count, Expected rent, Security deposits
      Tenant.aggregate([
        {
          $match: {
            ownerId: ownerObjId,
            propertyId: { $in: propertyIds },
            status: { $in: ['Active', 'Notice'] },
          },
        },
        {
          $group: {
            _id: null,
            occupiedBeds: { $sum: 1 },
            noticeCount: {
              $sum: { $cond: [{ $eq: ['$status', 'Notice'] }, 1, 0] },
            },
            expectedRent: { $sum: { $ifNull: ['$monthlyRent', 0] } },
            totalSecurityDeposit: { $sum: { $ifNull: ['$securityDeposit', 0] } },
          },
        },
      ]),

      // 2. RentPayment aggregation: Total collected rent for current billing month
      RentPayment.aggregate([
        {
          $match: {
            ownerId: ownerObjId,
            propertyId: { $in: propertyIds },
            billingMonth,
          },
        },
        {
          $group: {
            _id: null,
            collectedRent: { $sum: { $ifNull: ['$amount', 0] } },
          },
        },
      ]),

      // 3. RoomInventory aggregation: Total beds count across portfolio
      RoomInventory.aggregate([
        {
          $match: {
            ownerId: ownerObjId,
            propertyId: { $in: propertyIds },
          },
        },
        {
          $group: {
            _id: null,
            totalBeds: {
              $sum: {
                $cond: [
                  { $gt: [{ $ifNull: ['$totalBeds', 0] }, 0] },
                  '$totalBeds',
                  { $size: { $ifNull: ['$beds', []] } },
                ],
              },
            },
          },
        },
      ]),
    ]);

    const tStat = tenantStats[0] || {
      occupiedBeds: 0,
      noticeCount: 0,
      expectedRent: 0,
      totalSecurityDeposit: 0,
    };
    const pStat = paymentStats[0] || { collectedRent: 0 };
    let totalBedsCount = roomStats[0]?.totalBeds || 0;

    // Fallback: If no RoomInventory records exist yet, use properties' totalRooms
    if (totalBedsCount === 0) {
      properties.forEach((p) => {
        totalBedsCount += p.totalRooms || 1;
      });
    }

    const occupiedBeds = tStat.occupiedBeds;
    const noticeCount = tStat.noticeCount;
    const vacantBeds = Math.max(0, totalBedsCount - occupiedBeds);
    const occupancyRate = totalBedsCount > 0 ? Math.round((occupiedBeds / totalBedsCount) * 100) : 0;

    const expectedRent = tStat.expectedRent;
    const totalSecurityDeposit = tStat.totalSecurityDeposit;
    const collectedRent = pStat.collectedRent;
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

    // Only allow inventory access on active approved properties
    const [listing, rooms] = await Promise.all([
      Listing.findOne({ _id: propertyId, owner: ownerId, status: 'active' })
        .select('title address totalRooms availableRooms')
        .lean(),
      RoomInventory.find({ propertyId, ownerId })
        .sort({ floorNumber: 1, roomNumber: 1 })
        .lean(),
    ]);

    if (!listing) {
      return error(res, {
        message: 'Property not found, unauthorized, or not yet approved/published.',
        statusCode: 404,
      });
    }

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
    const {
      propertyId,
      roomNumber,
      floorNumber = 1,
      roomType = 'Single Room',
      totalBeds = 1,
      baseMonthlyRent = 0,
      attachedBathroom = true,
    } = req.body;

    if (!propertyId || !roomNumber) {
      return error(res, { message: 'propertyId and roomNumber are required', statusCode: 400 });
    }

    const cleanRoomType = normalizeRoomType(roomType, totalBeds);

    // Only allow room management on active approved properties
    const [listing, existingRoom] = await Promise.all([
      Listing.findOne({ _id: propertyId, owner: ownerId, status: 'active' }).select('_id').lean(),
      RoomInventory.findOne({ propertyId, roomNumber: String(roomNumber).trim() }),
    ]);

    if (!listing) {
      return error(res, {
        message: 'Cannot manage room inventory: Property not found, unauthorized, or not yet approved/published.',
        statusCode: 404,
      });
    }

    const parsedFloor =
      floorNumber !== undefined && floorNumber !== null && !isNaN(Number(floorNumber))
        ? Number(floorNumber)
        : String(roomNumber).trim().toUpperCase().startsWith('G')
        ? 0
        : 1;

    let savedRoom;

    if (existingRoom) {
      // Update existing room
      existingRoom.floorNumber = parsedFloor;
      existingRoom.roomType = cleanRoomType;
      existingRoom.baseMonthlyRent = baseMonthlyRent;
      existingRoom.attachedBathroom = attachedBathroom;

      const currentBeds = existingRoom.beds || [];
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
        existingRoom.beds = currentBeds;
      } else if (newTotal < currentBeds.length) {
        const kept = [];
        let toRemove = currentBeds.length - newTotal;
        for (let i = currentBeds.length - 1; i >= 0; i--) {
          if (toRemove > 0 && currentBeds[i].status === 'Vacant') {
            toRemove--;
          } else {
            kept.unshift(currentBeds[i]);
          }
        }
        existingRoom.beds = kept;
      }
      existingRoom.totalBeds = newTotal;
      savedRoom = await existingRoom.save();
    } else {
      // Create new room & atomically increment listing room counters
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

      savedRoom = await RoomInventory.create({
        propertyId,
        ownerId,
        floorNumber: parsedFloor,
        roomNumber: String(roomNumber).trim(),
        roomType: cleanRoomType,
        totalBeds: numBeds,
        baseMonthlyRent: Number(baseMonthlyRent) || 0,
        attachedBathroom,
        beds,
      });

      await Listing.updateOne(
        { _id: propertyId },
        { $inc: { totalRooms: 1, availableRooms: 1 } }
      );
    }

    return success(res, {
      message: 'Room inventory saved successfully',
      data: savedRoom,
      statusCode: 201,
    });
  } catch (err) {
    console.error('addOrUpdateRoom error:', err);
    return error(res, { message: 'Failed to save room inventory', error: err.message });
  }
};

// ─── POST /api/owner/crm/rooms/bulk ──────────────────────────────────────────
const bulkAddOrUpdateRooms = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { propertyId, rooms } = req.body;

    if (!propertyId || !Array.isArray(rooms) || rooms.length === 0) {
      return error(res, { message: 'propertyId and a non-empty rooms array are required', statusCode: 400 });
    }

    const listing = await Listing.findOne({ _id: propertyId, owner: ownerId, status: 'active' }).select('_id').lean();
    if (!listing) {
      return error(res, {
        message: 'Cannot manage room inventory: Property not found, unauthorized, or not yet approved/published.',
        statusCode: 404,
      });
    }

    const seenNumbers = new Set();
    const uniqueRooms = [];
    for (const r of rooms) {
      const num = String(r?.roomNumber || '').trim();
      if (!num || seenNumbers.has(num)) continue;
      seenNumbers.add(num);
      uniqueRooms.push(r);
    }

    const roomNumbers = Array.from(seenNumbers);
    const existingRooms = await RoomInventory.find({ propertyId, roomNumber: { $in: roomNumbers } });
    const existingMap = new Map(existingRooms.map((r) => [r.roomNumber, r]));

    const savedRooms = [];

    for (const r of uniqueRooms) {
      const roomNumber = String(r.roomNumber).trim();
      if (!roomNumber) continue;

      const numBeds = Math.max(1, Number(r.totalBeds) || (
        r.roomType === 'Double Sharing' ? 2 :
        r.roomType === 'Triple Sharing' ? 3 :
        r.roomType === 'Four Sharing' ? 4 : 1
      ));
      const cleanRoomType = normalizeRoomType(r.roomType, numBeds);

      const parsedFloor =
        r.floorNumber !== undefined && r.floorNumber !== null && !isNaN(Number(r.floorNumber))
          ? Number(r.floorNumber)
          : roomNumber.toUpperCase().startsWith('G')
          ? 0
          : 1;

      const existingRoom = existingMap.get(roomNumber);

      if (existingRoom) {
        existingRoom.floorNumber = parsedFloor;
        existingRoom.roomType = cleanRoomType;
        existingRoom.baseMonthlyRent = Number(r.baseMonthlyRent) || 0;
        existingRoom.attachedBathroom = r.attachedBathroom !== undefined ? Boolean(r.attachedBathroom) : true;

        const currentBeds = existingRoom.beds || [];
        const occupiedCount = currentBeds.filter((b) => b.status === 'Occupied' || b.status === 'Notice').length;
        const targetBeds = Math.max(numBeds, occupiedCount);

        if (targetBeds > currentBeds.length) {
          for (let i = currentBeds.length; i < targetBeds; i++) {
            currentBeds.push({
              label: `Bed ${i + 1}`,
              status: 'Vacant',
              occupiedBy: null,
              tenantName: '',
            });
          }
          existingRoom.beds = currentBeds;
        } else if (targetBeds < currentBeds.length) {
          const kept = [];
          let toRemove = currentBeds.length - targetBeds;
          for (let i = currentBeds.length - 1; i >= 0; i--) {
            if (toRemove > 0 && currentBeds[i].status === 'Vacant') {
              toRemove--;
            } else {
              kept.unshift(currentBeds[i]);
            }
          }
          existingRoom.beds = kept;
        }
        existingRoom.totalBeds = targetBeds;
        const saved = await existingRoom.save();
        savedRooms.push(saved);
      } else {
        const beds = [];
        for (let i = 0; i < numBeds; i++) {
          beds.push({
            label: `Bed ${i + 1}`,
            status: 'Vacant',
            occupiedBy: null,
            tenantName: '',
          });
        }

        const newRoom = await RoomInventory.create({
          propertyId,
          ownerId,
          floorNumber: parsedFloor,
          roomNumber,
          roomType: cleanRoomType,
          totalBeds: numBeds,
          baseMonthlyRent: Number(r.baseMonthlyRent) || 0,
          attachedBathroom: r.attachedBathroom !== undefined ? Boolean(r.attachedBathroom) : true,
          beds,
        });
        savedRooms.push(newRoom);
      }
    }

    // Recalculate listing inventory stats once
    const allRooms = await RoomInventory.find({ propertyId }).lean();
    let totalAvailableBeds = 0;
    allRooms.forEach((rm) => {
      const vacant = (rm.beds || []).filter((b) => b.status === 'Vacant').length;
      totalAvailableBeds += vacant;
    });

    await Listing.findByIdAndUpdate(propertyId, {
      totalRooms: allRooms.length,
      availableRooms: totalAvailableBeds,
    });

    return success(res, {
      message: `Successfully configured ${savedRooms.length} rooms`,
      data: {
        count: savedRooms.length,
        rooms: savedRooms,
      },
      statusCode: 201,
    });
  } catch (err) {
    console.error('bulkAddOrUpdateRooms error:', err);
    return error(res, { message: 'Failed to bulk configure rooms', error: err.message });
  }
};

// ─── DELETE /api/owner/crm/rooms/:roomId ───────────────────────────────────────
const deleteRoom = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { roomId } = req.params;
    const { propertyId } = req.query;

    if (!roomId) {
      return error(res, { message: 'roomId is required', statusCode: 400 });
    }

    const room = await RoomInventory.findOne({
      _id: roomId,
      ownerId,
      ...(propertyId && mongoose.Types.ObjectId.isValid(propertyId) ? { propertyId } : {}),
    }).lean();

    if (!room) {
      return error(res, { message: 'Room not found or unauthorized', statusCode: 404 });
    }

    // Ensure property is active
    const listing = await Listing.findOne({ _id: room.propertyId, owner: ownerId, status: 'active' }).select('_id').lean();
    if (!listing) {
      return error(res, { message: 'Cannot delete room: Property must be approved and published.', statusCode: 403 });
    }

    // Check active rentees assigned to this room
    const activeTenantCount = await Tenant.countDocuments({
      ownerId,
      propertyId: room.propertyId,
      roomNumber: room.roomNumber,
      status: { $in: ['Active', 'Notice'] },
    });

    if (activeTenantCount > 0) {
      return error(res, {
        message: `Cannot delete Room ${room.roomNumber} because ${activeTenantCount} active rentee(s) are assigned to it.`,
        statusCode: 400,
      });
    }

    await runInTransaction(async (session) => {
      const opts = session ? { session } : {};
      await RoomInventory.deleteOne({ _id: room._id }, opts);
      await Listing.updateOne(
        { _id: room.propertyId, totalRooms: { $gt: 0 } },
        { $inc: { totalRooms: -1, availableRooms: -1 } },
        opts
      );
    });

    return success(res, {
      message: `Room ${room.roomNumber} deleted successfully`,
      data: { roomId: room._id, roomNumber: room.roomNumber },
    });
  } catch (err) {
    console.error('deleteRoom error:', err);
    return error(res, { message: 'Failed to delete room', error: err.message });
  }
};

// ─── DELETE /api/owner/crm/rooms/all ───────────────────────────────────────────
const deleteAllRooms = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const propertyId = req.query.propertyId || req.body.propertyId;

    if (!propertyId || !mongoose.Types.ObjectId.isValid(propertyId)) {
      return error(res, { message: 'Valid propertyId is required', statusCode: 400 });
    }

    const [listing, activeTenantExists, occupiedRoomExists] = await Promise.all([
      Listing.findOne({ _id: propertyId, owner: ownerId, status: 'active' }).select('_id title').lean(),
      Tenant.exists({ ownerId, propertyId, status: { $in: ['Active', 'Notice'] } }),
      RoomInventory.exists({ propertyId, ownerId, 'beds.status': { $in: ['Occupied', 'Notice'] } }),
    ]);

    if (!listing) {
      return error(res, {
        message: 'Property not found, unauthorized, or not yet approved/published.',
        statusCode: 404,
      });
    }

    if (activeTenantExists) {
      return error(res, {
        message: 'Cannot delete all rooms: Active rentee(s) are currently assigned to this property. Please vacate all rentees first.',
        statusCode: 400,
      });
    }

    if (occupiedRoomExists) {
      return error(res, {
        message: 'Cannot delete all rooms: Some room(s) contain occupied beds.',
        statusCode: 400,
      });
    }

    let deletedCount = 0;

    await runInTransaction(async (session) => {
      const opts = session ? { session } : {};
      const deleteResult = await RoomInventory.deleteMany({ propertyId, ownerId }, opts);
      deletedCount = deleteResult.deletedCount;

      await Listing.updateOne(
        { _id: propertyId },
        { $set: { totalRooms: 0, availableRooms: 0, totalBeds: 0, availableBeds: 0 } },
        opts
      );
    });

    return success(res, {
      message: `Successfully deleted all ${deletedCount} rooms for ${listing.title}`,
      data: { deletedCount },
    });
  } catch (err) {
    console.error('deleteAllRooms error:', err);
    return error(res, { message: 'Failed to delete all rooms', error: err.message });
  }
};

// ─── GET /api/owner/crm/tenants ──────────────────────────────────────────────
const getTenants = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { propertyId, status, search } = req.query;

    // Restrict to active approved properties
    const activeProperties = await Listing.find({ owner: ownerId, status: 'active' }).select('_id').lean();
    const activePropertyIds = activeProperties.map((p) => p._id);

    if (activePropertyIds.length === 0) {
      return success(res, {
        message: 'Tenants retrieved successfully',
        data: [],
      });
    }

    const filter = { ownerId, propertyId: { $in: activePropertyIds } };
    if (propertyId && mongoose.Types.ObjectId.isValid(propertyId)) {
      if (activePropertyIds.some((id) => String(id) === String(propertyId))) {
        filter.propertyId = propertyId;
      } else {
        return success(res, {
          message: 'Tenants retrieved successfully',
          data: [],
        });
      }
    }

    if (status && ['Active', 'Notice', 'Moved Out'].includes(status)) {
      filter.status = status;
    }
    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      filter.$or = [{ name: regex }, { phone: regex }, { roomNumber: regex }];
    }

    const tenants = await Tenant.find(filter)
      .select('-documents')
      .populate('propertyId', 'title address rent')
      .sort({ createdAt: -1 })
      .lean();

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
      return error(res, {
        message: 'Missing required tenant fields: propertyId, roomNumber, name, phone, monthlyRent',
        statusCode: 400,
      });
    }

    const cleanPhone = String(phone).trim().replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return error(res, {
        message: 'Please enter a valid 10-digit mobile number for the tenant',
        statusCode: 400,
      });
    }

    if (emergencyContact && emergencyContact.phone && emergencyContact.phone.trim()) {
      const cleanEmerg = String(emergencyContact.phone).trim().replace(/\D/g, '');
      if (!/^[6-9]\d{9}$/.test(cleanEmerg)) {
        return error(res, {
          message: 'Please enter a valid 10-digit emergency contact phone number',
          statusCode: 400,
        });
      }
    }

    // Only allow tenant onboarding on active approved properties
    const [listing, room] = await Promise.all([
      Listing.findOne({ _id: propertyId, owner: ownerId, status: 'active' }).select('_id').lean(),
      RoomInventory.findOne({ propertyId, roomNumber: String(roomNumber).trim() }).lean(),
    ]);

    if (!listing) {
      return error(res, {
        message: 'Cannot onboard rentee: Property not found, unauthorized, or not yet approved/published.',
        statusCode: 404,
      });
    }

    let chosenBedLabel = bedLabel || 'Bed 1';
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
          chosenBedLabel = targetBed.label;
        }
      }

      if (!bedLabel || !room.beds.some((b) => b.label === chosenBedLabel)) {
        const firstVacant = room.beds.find((b) => b.status === 'Vacant');
        if (!firstVacant) {
          return error(res, {
            message: `Room ${roomNumber} has no vacant beds available.`,
            statusCode: 400,
          });
        }
        chosenBedLabel = firstVacant.label;
      }
    }

    // Execute creation, atomic bed allocation, and listing availability update inside a transaction
    const createdTenant = await runInTransaction(async (session) => {
      const opts = session ? { session } : {};

      const [tenant] = await Tenant.create(
        [
          {
            ownerId,
            propertyId,
            roomId: room ? room._id : roomId,
            roomNumber: String(roomNumber).trim(),
            bedLabel: chosenBedLabel,
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
          },
        ],
        opts
      );

      if (room) {
        const updatedRoom = await RoomInventory.findOneAndUpdate(
          {
            propertyId,
            roomNumber: String(roomNumber).trim(),
            'beds.label': chosenBedLabel,
            'beds.status': 'Vacant',
          },
          {
            $set: {
              'beds.$.status': 'Occupied',
              'beds.$.occupiedBy': tenant._id,
              'beds.$.tenantName': tenant.name,
            },
          },
          { ...opts, new: true }
        );

        if (!updatedRoom) {
          const err = new Error(
            `${chosenBedLabel} in Room ${roomNumber} was just occupied. Please select another bed.`
          );
          err.statusCode = 409;
          throw err;
        }
      }

      // Atomically decrement listing availability counters
      await Listing.updateOne(
        { _id: propertyId, availableBeds: { $gt: 0 } },
        { $inc: { availableBeds: -1, availableRooms: -1 } },
        opts
      );

      return tenant;
    });


    return success(res, {
      message: 'Rentee onboarded successfully',
      data: createdTenant,
      statusCode: 201,
    });
  } catch (err) {
    console.error('addTenant error:', err);
    return error(res, { message: err.message || 'Failed to add tenant', statusCode: err.statusCode || 500 });
  }
};

// ─── PUT /api/owner/crm/tenants/:id ──────────────────────────────────────────
const updateTenant = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { id } = req.params;
    const {
      status,
      noticeDate,
      expectedVacateDate,
      moveInDate,
      monthlyRent,
      securityDeposit,
      roomNumber,
      bedLabel,
      emergencyContact,
      notes,
      name,
      phone,
      email,
      avatar,
      documents,
    } = req.body;

    const tenant = await Tenant.findOne({ _id: id, ownerId });
    if (!tenant) {
      return error(res, { message: 'Tenant not found or unauthorized', statusCode: 404 });
    }

    if (phone) {
      const cleanPhone = String(phone).trim().replace(/\D/g, '');
      if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
        return error(res, {
          message: 'Please enter a valid 10-digit mobile number for the tenant',
          statusCode: 400,
        });
      }
    }

    if (emergencyContact && emergencyContact.phone && emergencyContact.phone.trim()) {
      const cleanEmerg = String(emergencyContact.phone).trim().replace(/\D/g, '');
      if (!/^[6-9]\d{9}$/.test(cleanEmerg)) {
        return error(res, {
          message: 'Please enter a valid 10-digit emergency contact phone number',
          statusCode: 400,
        });
      }
    }

    // Verify property is active
    const listing = await Listing.findOne({ _id: tenant.propertyId, owner: ownerId, status: 'active' }).select('_id').lean();
    if (!listing) {
      return error(res, {
        message: 'Cannot manage tenant: Associated property is not active or approved.',
        statusCode: 403,
      });
    }

    const previousStatus = tenant.status;
    const oldRoomNumber = tenant.roomNumber;
    const oldBedLabel = tenant.bedLabel;
    const targetRoomNumber = roomNumber ? String(roomNumber).trim() : oldRoomNumber;
    const targetBedLabel = bedLabel || oldBedLabel;
    const isRoomOrBedChanged =
      (roomNumber && targetRoomNumber !== oldRoomNumber) || (bedLabel && targetBedLabel !== oldBedLabel);

    await runInTransaction(async (session) => {
      const opts = session ? { session } : {};

      // 1. Handle Room/Bed shifts atomically
      if (isRoomOrBedChanged && tenant.status !== 'Moved Out') {
        // Free previous bed
        await RoomInventory.updateOne(
          { propertyId: tenant.propertyId, roomNumber: oldRoomNumber, 'beds.occupiedBy': tenant._id },
          { $set: { 'beds.$.status': 'Vacant', 'beds.$.occupiedBy': null, 'beds.$.tenantName': '' } },
          opts
        );

        // Claim target bed
        const claimed = await RoomInventory.findOneAndUpdate(
          {
            propertyId: tenant.propertyId,
            roomNumber: targetRoomNumber,
            'beds.label': targetBedLabel,
            'beds.status': 'Vacant',
          },
          {
            $set: {
              'beds.$.status': (status || tenant.status) === 'Notice' ? 'Notice' : 'Occupied',
              'beds.$.occupiedBy': tenant._id,
              'beds.$.tenantName': name ? name.trim() : tenant.name,
            },
          },
          { ...opts, new: true }
        );

        if (!claimed) {
          const roomExists = await RoomInventory.exists({
            propertyId: tenant.propertyId,
            roomNumber: targetRoomNumber,
          }, opts);

          if (roomExists) {
            const err = new Error(`${targetBedLabel} in Room ${targetRoomNumber} is already occupied.`);
            err.statusCode = 400;
            throw err;
          }
        }
      }

      // 2. Handle status transitions atomically
      if (status && status !== previousStatus) {
        tenant.status = status;

        if (status === 'Notice') {
          tenant.noticeDate = noticeDate || new Date();
          tenant.expectedVacateDate = expectedVacateDate || null;

          await RoomInventory.updateOne(
            { propertyId: tenant.propertyId, roomNumber: tenant.roomNumber, 'beds.occupiedBy': tenant._id },
            { $set: { 'beds.$.status': 'Notice' } },
            opts
          );
        } else if (status === 'Moved Out') {
          tenant.moveOutDate = new Date();

          await RoomInventory.updateOne(
            { propertyId: tenant.propertyId, roomNumber: tenant.roomNumber, 'beds.occupiedBy': tenant._id },
            { $set: { 'beds.$.status': 'Vacant', 'beds.$.occupiedBy': null, 'beds.$.tenantName': '' } },
            opts
          );
          await Listing.updateOne(
            { _id: tenant.propertyId },
            { $inc: { availableBeds: 1, availableRooms: 1 } },
            opts
          );
        } else if (status === 'Active' && previousStatus === 'Notice') {
          tenant.noticeDate = null;
          tenant.expectedVacateDate = null;

          await RoomInventory.updateOne(
            { propertyId: tenant.propertyId, roomNumber: tenant.roomNumber, 'beds.occupiedBy': tenant._id },
            { $set: { 'beds.$.status': 'Occupied' } },
            opts
          );
        }
      }

      // Update tenant fields
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

      await tenant.save(opts);
    });

    return success(res, {
      message: 'Tenant details updated successfully',
      data: tenant,
    });
  } catch (err) {
    console.error('updateTenant error:', err);
    return error(res, { message: err.message || 'Failed to update tenant', statusCode: err.statusCode || 500 });
  }
};

// ─── DELETE /api/owner/crm/tenants/:id ───────────────────────────────────────
const deleteTenant = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { id } = req.params;

    const tenant = await Tenant.findOne({ _id: id, ownerId }).lean();
    if (!tenant) {
      return error(res, { message: 'Tenant not found or unauthorized', statusCode: 404 });
    }

    const listing = await Listing.findOne({ _id: tenant.propertyId, owner: ownerId, status: 'active' }).select('_id').lean();
    if (!listing) {
      return error(res, {
        message: 'Cannot delete tenant: Associated property is not active or approved.',
        statusCode: 403,
      });
    }

    await runInTransaction(async (session) => {
      const opts = session ? { session } : {};
      await Tenant.findByIdAndDelete(id, opts);

      if (tenant.status !== 'Moved Out') {
        await RoomInventory.updateOne(
          { propertyId: tenant.propertyId, roomNumber: tenant.roomNumber, 'beds.occupiedBy': tenant._id },
          { $set: { 'beds.$.status': 'Vacant', 'beds.$.occupiedBy': null, 'beds.$.tenantName': '' } },
          opts
        );
        await Listing.updateOne(
          { _id: tenant.propertyId },
          { $inc: { availableBeds: 1, availableRooms: 1 } },
          opts
        );
      }
    });

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

    const propertyFilter = { owner: ownerId, status: 'active' };
    if (propertyId && mongoose.Types.ObjectId.isValid(propertyId)) {
      propertyFilter._id = propertyId;
    }
    const properties = await Listing.find(propertyFilter).select('_id title').lean();
    const propertyIds = properties.map((p) => p._id);

    if (propertyIds.length === 0) {
      return success(res, {
        message: 'Ledger retrieved successfully',
        data: {
          billingMonth,
          summary: {
            totalExpected: 0,
            totalCollected: 0,
            totalPending: 0,
            totalSecurityDeposit: 0,
            paidCount: 0,
            partialCount: 0,
            pendingCount: 0,
          },
          ledger: [],
        },
      });
    }

    // Concurrently fetch active tenants and payments with minimal fields and .lean()
    const [tenants, payments] = await Promise.all([
      Tenant.find({
        ownerId,
        propertyId: { $in: propertyIds },
        status: { $in: ['Active', 'Notice'] },
      })
        .select('name phone roomNumber bedLabel monthlyRent securityDeposit propertyId')
        .populate('propertyId', 'title')
        .lean(),
      RentPayment.find({
        ownerId,
        propertyId: { $in: propertyIds },
        billingMonth,
      })
        .sort({ paymentDate: -1 })
        .lean(),
    ]);

    // O(M) Hash Map payment grouping instead of O(N*M) nested filter loop
    const paymentsByTenantId = new Map();
    for (const p of payments) {
      const tid = String(p.tenantId);
      if (!paymentsByTenantId.has(tid)) {
        paymentsByTenantId.set(tid, []);
      }
      paymentsByTenantId.get(tid).push(p);
    }

    // Build ledger matrix in single O(N) pass
    const ledger = tenants.map((tenant) => {
      const tenantPayments = paymentsByTenantId.get(String(tenant._id)) || [];
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
    const {
      tenantId,
      propertyId,
      billingMonth = getCurrentBillingMonth(),
      amount,
      paymentDate = new Date(),
      paymentMode = 'UPI',
      referenceNumber = '',
      notes = '',
    } = req.body;

    if (!tenantId || !amount || Number(amount) <= 0) {
      return error(res, { message: 'tenantId and positive amount are required', statusCode: 400 });
    }

    const tenant = await Tenant.findOne({ _id: tenantId, ownerId })
      .select('name roomNumber propertyId')
      .lean();

    if (!tenant) {
      return error(res, { message: 'Tenant not found or unauthorized', statusCode: 404 });
    }

    const listing = await Listing.findOne({ _id: tenant.propertyId, owner: ownerId, status: 'active' }).select('_id').lean();
    if (!listing) {
      return error(res, {
        message: 'Cannot record payment: Associated property is not active or approved.',
        statusCode: 403,
      });
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

    const propertyFilter = { owner: ownerId, status: 'active' };
    if (propertyId && mongoose.Types.ObjectId.isValid(propertyId)) {
      propertyFilter._id = propertyId;
    }
    const properties = await Listing.find(propertyFilter).select('_id').lean();
    const propertyIds = properties.map((p) => p._id);

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

    if (propertyIds.length === 0) {
      return success(res, {
        message: 'Financial analytics retrieved',
        data: {
          monthlyTrend: months.map((month) => ({ month, expected: 0, collected: 0 })),
          paymentModes: [],
        },
      });
    }

    const ownerObjId = new mongoose.Types.ObjectId(ownerId);

    // Native MongoDB $facet aggregation computes monthly trend & payment mode breakdown directly
    const [analyticsResult, activeTenantsSum] = await Promise.all([
      RentPayment.aggregate([
        {
          $match: {
            ownerId: ownerObjId,
            propertyId: { $in: propertyIds },
            billingMonth: { $in: months },
          },
        },
        {
          $facet: {
            monthlyTotals: [
              { $group: { _id: '$billingMonth', collected: { $sum: '$amount' } } },
            ],
            paymentModes: [
              { $group: { _id: { $ifNull: ['$paymentMode', 'UPI'] }, amount: { $sum: '$amount' } } },
            ],
          },
        },
      ]),
      Tenant.aggregate([
        {
          $match: {
            ownerId: ownerObjId,
            propertyId: { $in: propertyIds },
            status: { $in: ['Active', 'Notice'] },
          },
        },
        {
          $group: {
            _id: null,
            baseExpected: { $sum: { $ifNull: ['$monthlyRent', 0] } },
          },
        },
      ]),
    ]);

    const baseExpected = activeTenantsSum[0]?.baseExpected || 0;
    const monthlyMap = new Map();
    (analyticsResult[0]?.monthlyTotals || []).forEach((m) => {
      monthlyMap.set(m._id, m.collected);
    });

    const monthlyTrend = months.map((month) => ({
      month,
      expected: baseExpected,
      collected: monthlyMap.get(month) || 0,
    }));

    const modeTotals = {
      UPI: 0,
      Cash: 0,
      'Bank Transfer': 0,
      Cheque: 0,
      Other: 0,
    };

    (analyticsResult[0]?.paymentModes || []).forEach((pm) => {
      if (modeTotals[pm._id] !== undefined) {
        modeTotals[pm._id] += pm.amount;
      } else {
        modeTotals.Other += pm.amount;
      }
    });

    return success(res, {
      message: 'Financial analytics retrieved',
      data: {
        monthlyTrend,
        paymentModes: Object.entries(modeTotals).map(([mode, amount]) => ({ mode, amount })),
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

    // Filter by owner's active/published properties
    const activeProperties = await Listing.find({ owner: ownerId, status: 'active' }).select('_id').lean();
    const activePropertyIds = activeProperties.map((p) => p._id);

    if (activePropertyIds.length === 0) {
      return success(res, {
        message: 'Payment history retrieved successfully',
        data: {
          totalAmount: 0,
          count: 0,
          payments: [],
        },
      });
    }

    const filter = { ownerId, propertyId: { $in: activePropertyIds } };

    if (propertyId && propertyId !== 'ALL' && mongoose.Types.ObjectId.isValid(propertyId)) {
      if (activePropertyIds.some((id) => String(id) === String(propertyId))) {
        filter.propertyId = propertyId;
      } else {
        return success(res, {
          message: 'Payment history retrieved successfully',
          data: {
            totalAmount: 0,
            count: 0,
            payments: [],
          },
        });
      }
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
      .sort({ paymentDate: -1, createdAt: -1 })
      .lean();

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

    const [tenant, payments] = await Promise.all([
      Tenant.findOne({ _id: id, ownerId })
        .populate('propertyId', 'title address city area images status')
        .lean(),
      RentPayment.find({ tenantId: id, ownerId })
        .sort({ paymentDate: -1, createdAt: -1 })
        .lean(),
    ]);

    if (!tenant) {
      return error(res, { message: 'Tenant not found or unauthorized', statusCode: 404 });
    }

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
      { wch: 20 },
      { wch: 15 },
      { wch: 26 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 16 },
      { wch: 14 },
      { wch: 20 },
      { wch: 16 },
      { wch: 18 },
      { wch: 28 },
    ];

    const wsInstructions = XLSX.utils.json_to_sheet(instructionData);
    wsInstructions['!cols'] = [
      { wch: 20 },
      { wch: 16 },
      { wch: 60 },
      { wch: 25 },
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
    let { propertyId, tenants } = req.body;

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

    // 1. Preload property (active only), existing active rentees, and current room inventory in parallel
    const [listing, existingTenants, rooms] = await Promise.all([
      Listing.findOne({ _id: propertyId, owner: ownerId, status: 'active' }).select('_id').lean(),
      Tenant.find({ propertyId, status: { $in: ['Active', 'Notice'] } }).select('phone').lean(),
      RoomInventory.find({ propertyId }),
    ]);

    if (!listing) {
      return error(res, {
        message: 'Cannot bulk upload rentees: Property not found, unauthorized, or not yet approved/published.',
        statusCode: 404,
      });
    }

    const existingPhones = new Set(existingTenants.map((t) => String(t.phone).trim()));
    const roomMap = new Map();
    rooms.forEach((r) => {
      roomMap.set(String(r.roomNumber).trim(), r);
    });

    const tenantsToInsert = [];
    const successRows = [];
    const failedRows = [];
    const batchPhonesInPayload = new Set();
    const batchBedKeysInPayload = new Set();
    const roomsToUpdateMap = new Map();

    // 2. Validate all rows in memory
    for (let index = 0; index < tenants.length; index++) {
      const raw = tenants[index];
      const rowNum = index + 2;

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
          parsedDate = new Date(Math.round((moveInDate - 25569) * 86400 * 1000));
        } else {
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

      if (!name) {
        failedRows.push({ row: rowNum, name: name || 'Unnamed', reason: 'Full Name is required' });
        continue;
      }

      if (!phone || !/^[6-9]\d{9}$/.test(phone)) {
        failedRows.push({ row: rowNum, name, reason: `Invalid phone number: '${raw['Phone Number'] || raw.phone || ''}'. Must be a valid 10-digit mobile number.` });
        continue;
      }

      let cleanEmergencyPhone = emergencyPhone.replace(/\D/g, '');
      if (cleanEmergencyPhone.length > 10 && cleanEmergencyPhone.startsWith('91')) {
        cleanEmergencyPhone = cleanEmergencyPhone.slice(2);
      }
      if (cleanEmergencyPhone && !/^[6-9]\d{9}$/.test(cleanEmergencyPhone)) {
        failedRows.push({ row: rowNum, name, reason: `Invalid emergency phone: '${raw['Emergency Phone'] || raw.emergencyPhone || ''}'. Must be a valid 10-digit mobile number.` });
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

      if (!rawBedLabel) {
        failedRows.push({
          row: rowNum,
          name,
          reason: 'Bed Label is required. For single occupancy rooms, enter "Bed 1".',
        });
        continue;
      }

      let normalizedBedLabel = rawBedLabel;
      if (/^\d+$/.test(rawBedLabel)) {
        normalizedBedLabel = `Bed ${rawBedLabel}`;
      } else if (/^bed\s*\d+$/i.test(rawBedLabel)) {
        const numPart = rawBedLabel.replace(/\D/g, '');
        normalizedBedLabel = `Bed ${numPart}`;
      }

      if (existingPhones.has(phone)) {
        failedRows.push({ row: rowNum, name, reason: `Phone number ${phone} is already registered to an active rentee in this property` });
        continue;
      }

      if (batchPhonesInPayload.has(phone)) {
        failedRows.push({ row: rowNum, name, reason: `Duplicate phone number ${phone} appears multiple times in the upload` });
        continue;
      }

      const batchBedKey = `${roomNumber}::${normalizedBedLabel}`.toLowerCase();
      if (batchBedKeysInPayload.has(batchBedKey)) {
        failedRows.push({ row: rowNum, name, reason: `Room ${roomNumber} - ${normalizedBedLabel} is assigned more than once in this batch` });
        continue;
      }

      let targetRoom = roomMap.get(roomNumber);
      if (!targetRoom) {
        failedRows.push({
          row: rowNum,
          name,
          reason: `Room ${roomNumber} does not exist in property inventory. Please configure rooms before uploading rentees.`,
        });
        continue;
      }

      let targetBed = (targetRoom.beds || []).find((b) => b.label.toLowerCase() === normalizedBedLabel.toLowerCase());
      if (!targetBed) {
        failedRows.push({
          row: rowNum,
          name,
          reason: `${normalizedBedLabel} does not exist in Room ${roomNumber}. Available beds: ${(targetRoom.beds || []).map((b) => b.label).join(', ') || 'None'}`,
        });
        continue;
      }

      if (targetBed.status !== 'Vacant') {
        failedRows.push({
          row: rowNum,
          name,
          reason: `${normalizedBedLabel} in Room ${roomNumber} is already ${targetBed.status}${targetBed.tenantName ? ` (${targetBed.tenantName})` : ''}`,
        });
        continue;
      }

      const newTenantId = new mongoose.Types.ObjectId();
      tenantsToInsert.push({
        _id: newTenantId,
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

      targetBed.status = 'Occupied';
      targetBed.occupiedBy = newTenantId;
      targetBed.tenantName = name;
      roomsToUpdateMap.set(String(targetRoom._id), targetRoom);

      existingPhones.add(phone);
      batchPhonesInPayload.add(phone);
      batchBedKeysInPayload.add(batchBedKey);

      successRows.push({
        row: rowNum,
        tenantId: newTenantId,
        name,
        roomNumber,
        bedLabel: targetBed.label,
        phone,
      });
    }

    // 3. Execute batch operations inside a transaction
    if (tenantsToInsert.length > 0) {
      await runInTransaction(async (session) => {
        const opts = session ? { session } : {};

        const bulkRoomOps = Array.from(roomsToUpdateMap.values()).map((roomDoc) => ({
          updateOne: {
            filter: { _id: roomDoc._id },
            update: { $set: { beds: roomDoc.beds } },
          },
        }));

        await Tenant.insertMany(tenantsToInsert, opts);

        if (bulkRoomOps.length > 0) {
          await RoomInventory.bulkWrite(bulkRoomOps, opts);
        }

        await Listing.updateOne(
          { _id: propertyId },
          { $inc: { availableBeds: -tenantsToInsert.length, availableRooms: -tenantsToInsert.length } },
          opts
        );
      });
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
  bulkAddOrUpdateRooms,
  deleteRoom,
  deleteAllRooms,
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
