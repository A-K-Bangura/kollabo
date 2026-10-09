// Fixture values for the test run only (they protect nothing).
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
process.env.SESSION_SECRET = 'test-session-secret-0123456789abcdef0123456789'
process.env.ACCESS_CODE_PEPPER = 'test-pepper-secret-fedcba9876543210fedcba9876543210'
