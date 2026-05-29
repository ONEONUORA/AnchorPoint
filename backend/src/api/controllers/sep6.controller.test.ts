import { Response } from 'express';
import prisma from '../../lib/prisma';
import {
  sep6Deposit,
  sep6GetTransaction,
  sep6GetTransactions,
  sep6Info,
  sep6Withdraw,
} from './sep6.controller';

jest.mock('../../lib/prisma', () => ({
  user: {
    upsert: jest.fn(),
  },
  transaction: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
}));

describe('SEP-6 Controller', () => {
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    mockResponse = {
      json: jsonMock,
      status: statusMock,
    };
  });

  describe('sep6Info', () => {
    it('returns deposit and withdraw info maps', () => {
      sep6Info({} as any, mockResponse as Response);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          deposit: expect.any(Object),
          withdraw: expect.any(Object),
        })
      );
    });
  });

  describe('sep6Deposit', () => {
    it('returns 400 for unsupported asset', async () => {
      const req = {
        query: { asset_code: 'NOPE' },
        user: { publicKey: 'GTEST' },
      } as any;

      await sep6Deposit(req, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Asset NOPE is not supported for deposit.',
      });
    });

    it('creates a pending transaction and returns instructions', async () => {
      (prisma.transaction.create as jest.Mock).mockResolvedValue({ id: 'tx_1' });

      const req = {
        query: {
          asset_code: 'USDC',
          amount: '10',
          email_address: 'bench@example.com',
        },
        user: { publicKey: 'GTEST' },
      } as any;

      await sep6Deposit(req, mockResponse as Response);

      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'DEPOSIT',
            status: 'PENDING',
            assetCode: 'USDC',
            user: expect.objectContaining({
              connectOrCreate: expect.objectContaining({
                where: { publicKey: 'GTEST' },
              }),
            }),
          }),
        })
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'tx_1',
          how: expect.stringContaining('Send USDC'),
        })
      );
    });

    it('returns fee_amount in the response', async () => {
      (prisma.transaction.create as jest.Mock).mockResolvedValue({ id: 'tx_fee_d' });

      const req = {
        query: { asset_code: 'USDC', amount: '200' },
        user: { publicKey: 'GTEST' },
      } as any;

      await sep6Deposit(req, mockResponse as Response);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ fee_amount: expect.any(String) })
      );
    });

    it('stores feeAmount, feeAssetCode, and feeType on the transaction', async () => {
      (prisma.transaction.create as jest.Mock).mockResolvedValue({ id: 'tx_fstore_d' });

      const req = {
        query: { asset_code: 'USDC', amount: '50' },
        user: { publicKey: 'GTEST' },
      } as any;

      await sep6Deposit(req, mockResponse as Response);

      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            feeAmount: expect.any(String),
            feeAssetCode: 'USDC',
            feeType: 'FLAT',
          }),
        })
      );
    });

    it('stores senderInfo with email, first_name, and last_name', async () => {
      (prisma.transaction.create as jest.Mock).mockResolvedValue({ id: 'tx_si' });

      const req = {
        query: {
          asset_code: 'USDC',
          amount: '25',
          email_address: 'alice@example.com',
          first_name: 'Alice',
          last_name: 'Smith',
        },
        user: { publicKey: 'GTEST' },
      } as any;

      await sep6Deposit(req, mockResponse as Response);

      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            senderInfo: expect.objectContaining({
              email_address: 'alice@example.com',
              first_name: 'Alice',
              last_name: 'Smith',
            }),
          }),
        })
      );
    });

    it('stores callbackUrl when callback_url is provided', async () => {
      (prisma.transaction.create as jest.Mock).mockResolvedValue({ id: 'tx_cb_d' });

      const req = {
        query: {
          asset_code: 'USDC',
          amount: '10',
          callback_url: 'https://my.app/deposit-callback',
        },
        user: { publicKey: 'GTEST' },
      } as any;

      await sep6Deposit(req, mockResponse as Response);

      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ callbackUrl: 'https://my.app/deposit-callback' }),
        })
      );
    });

    it('stores memo and memo_type in senderInfo when provided', async () => {
      (prisma.transaction.create as jest.Mock).mockResolvedValue({ id: 'tx_memo_d' });

      const req = {
        query: { asset_code: 'USDC', amount: '10', memo: 'order-42', memo_type: 'text' },
        user: { publicKey: 'GTEST' },
      } as any;

      await sep6Deposit(req, mockResponse as Response);

      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            senderInfo: expect.objectContaining({ memo: 'order-42', memo_type: 'text' }),
          }),
        })
      );
    });

    it('uses the caller-supplied memo in the response extra_info', async () => {
      (prisma.transaction.create as jest.Mock).mockResolvedValue({ id: 'tx_memo_resp' });

      const req = {
        query: { asset_code: 'USDC', amount: '10', memo: 'custom-memo', memo_type: 'text' },
        user: { publicKey: 'GTEST' },
      } as any;

      await sep6Deposit(req, mockResponse as Response);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          extra_info: expect.objectContaining({ memo: 'custom-memo' }),
        })
      );
    });

    it('returns 400 when amount is NaN', async () => {
      const req = {
        query: { asset_code: 'USDC', amount: 'abc' },
        user: { publicKey: 'GTEST' },
      } as any;

      await sep6Deposit(req, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('returns 400 when amount is below minimum', async () => {
      const req = {
        query: { asset_code: 'USDC', amount: '0.001' },
        user: { publicKey: 'GTEST' },
      } as any;

      await sep6Deposit(req, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('returns 400 when amount exceeds maximum', async () => {
      const req = {
        query: { asset_code: 'USDC', amount: '9999999' },
        user: { publicKey: 'GTEST' },
      } as any;

      await sep6Deposit(req, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('returns 500 when the database throws', async () => {
      (prisma.transaction.create as jest.Mock).mockRejectedValue(new Error('DB unavailable'));

      const req = {
        query: { asset_code: 'USDC', amount: '10' },
        user: { publicKey: 'GTEST' },
      } as any;

      await sep6Deposit(req, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Failed to initiate deposit.' });
    });
  });

  describe('sep6Withdraw', () => {
    it('returns 400 when dest is missing', async () => {
      const req = {
        query: { asset_code: 'USDC' },
        user: { publicKey: 'GTEST' },
      } as any;

      await sep6Withdraw(req, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'dest is required for withdrawal.' });
    });

    it('creates a pending withdraw transaction', async () => {
      (prisma.transaction.create as jest.Mock).mockResolvedValue({ id: 'tx_2' });

      const req = {
        query: { asset_code: 'USDC', amount: '5', dest: 'bank-1' },
        user: { publicKey: 'GTEST' },
      } as any;

      await sep6Withdraw(req, mockResponse as Response);

      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'WITHDRAW',
            status: 'PENDING',
            assetCode: 'USDC',
          }),
        })
      );

      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'tx_2' }));
    });
  });

  describe('sep6GetTransaction', () => {
    it('returns 400 when no identifiers are provided', async () => {
      const req = {
        query: {},
        user: { publicKey: 'GTEST' },
      } as any;

      await sep6GetTransaction(req, mockResponse as Response);
      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('returns 404 when transaction is not found', async () => {
      (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(null);

      const req = {
        query: { id: 'missing' },
        user: { publicKey: 'GTEST' },
      } as any;

      await sep6GetTransaction(req, mockResponse as Response);
      expect(statusMock).toHaveBeenCalledWith(404);
    });
  });

  describe('sep6GetTransactions', () => {
    it('returns transactions list', async () => {
      (prisma.transaction.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'tx_1',
          assetCode: 'USDC',
          amount: '1',
          type: 'DEPOSIT',
          status: 'PENDING',
          externalId: null,
          stellarTxId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const req = {
        query: { asset_code: 'USDC', limit: '1' },
        user: { publicKey: 'GTEST' },
      } as any;

      await sep6GetTransactions(req, mockResponse as Response);
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ transactions: expect.any(Array) }));
    });
  });
});
