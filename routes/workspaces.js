const express = require('express');
const { secure } = require('../middleware/routeRegistry');
const { logEvent } = require('../lib/logger');
const { createStaffService } = require('../services/staffService');

function sendError(res, error, label) {
  if (error.status) return res.status(error.status).json({ success: false, message: error.message, errors: error.errors });
  console.error(`${label}:`, error.message);
  return res.status(500).json({ success: false, message: 'Hệ thống đang bận. Vui lòng thử lại sau.' });
}

function createWorkspaceRouter(options = {}) {
  const router = express.Router();
  const db = options.db;
  const staffService = options.staffService || createStaffService(db);

  secure(router, 'get', '/buyer', { roles: ['buyer'] }, async (_req, res) => {
    try {
      const events = await db('events').where({ status: 'published' }).select('id', 'title', 'description').orderBy('id', 'desc');
      return res.json({ success: true, data: { events } });
    } catch (error) { return sendError(res, error, 'Buyer workspace error'); }
  });

  secure(router, 'get', '/checker', { roles: ['checker', 'admin'] }, async (_req, res) => {
    return res.json({ success: true, data: { checkedInToday: 0, message: 'Chưa có vé chờ soát.' } });
  });

  secure(router, 'get', '/accountant', { roles: ['accountant', 'admin'] }, async (_req, res) => {
    return res.json({ success: true, data: { grossRevenue: 0, transactions: 0, message: 'Chưa có giao dịch để đối soát.' } });
  });

  secure(router, 'get', '/admin/staff', { roles: ['admin'] }, async (_req, res) => {
    try { return res.json({ success: true, data: await staffService.listStaff() }); }
    catch (error) { return sendError(res, error, 'List staff error'); }
  });

  secure(router, 'post', '/admin/staff', { roles: ['admin'] }, async (req, res) => {
    try {
      const user = await staffService.createStaff(req.body);
      logEvent('staff_created', { userId: req.user.id, status: 201 });
      return res.status(201).json({ success: true, data: user });
    } catch (error) { return sendError(res, error, 'Create staff error'); }
  });

  secure(router, 'put', '/admin/staff/:id/roles', { roles: ['admin'] }, async (req, res) => {
    try {
      const user = await staffService.updateRoles(Number(req.params.id), req.body?.roles);
      logEvent('staff_roles_updated', { userId: req.user.id, status: 200 });
      return res.json({ success: true, data: user });
    } catch (error) { return sendError(res, error, 'Update staff roles error'); }
  });

  secure(router, 'patch', '/admin/staff/:id/status', { roles: ['admin'] }, async (req, res) => {
    try {
      if (typeof req.body?.is_active !== 'boolean') return res.status(400).json({ success: false, message: 'is_active phải là boolean.' });
      const result = await staffService.setActive(Number(req.params.id), req.body.is_active, req.user.id);
      logEvent('staff_status_updated', { userId: req.user.id, status: 200 });
      return res.json({ success: true, data: result });
    } catch (error) { return sendError(res, error, 'Update staff status error'); }
  });

  return router;
}

module.exports = { createWorkspaceRouter };
