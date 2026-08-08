'use strict';

/**
 * mintTeacherAToken.js — mint a fresh Teacher A (sub:1) JWT for local RC-1
 * testing, bypassing the WhatsApp OTP flow (routes/auth.js).
 *
 * Matches the exact signing config in routes/auth.js's handleVerifyCode:
 *   jwt.sign({ sub: teacher.id }, secret, { expiresIn: '1h' })
 * so tokens minted here are accepted by requireTeacherAuth with no changes.
 *
 * Usage: node mintTeacherAToken.js [teacherId]
 *   (defaults to teacherId 1, i.e. Teacher A)
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');

const teacherId = parseInt(process.argv[2], 10) || 1;
const secret = process.env.TEACHER_JWT_SECRET;

if (!secret) {
  console.error('TEACHER_JWT_SECRET is not set in your environment/.env — cannot sign a token.');
  process.exit(1);
}

const token = jwt.sign({ sub: teacherId }, secret, { expiresIn: '1h' });

console.log(`--- Fresh token minted ---`);
console.log(`teacherId (sub): ${teacherId}`);
console.log(`expires in:      1h`);
console.log(`token:            ${token}`);
