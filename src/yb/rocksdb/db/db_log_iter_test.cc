//  Copyright (c) 2011-present, Facebook, Inc.  All rights reserved.
//  This source code is licensed under the BSD-style license found in the
//  LICENSE file in the root directory of this source tree. An additional grant
//  of patent rights can be found in the PATENTS file in the same directory.
//
// The following only applies to changes made to this file as part of YugaByte development.
//
// Portions Copyright (c) YugaByte, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.  You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software distributed under the License
// is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
// or implied.  See the License for the specific language governing permissions and limitations
// under the License.
//
// Copyright (c) 2011 The LevelDB Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file. See the AUTHORS file for names of contributors.

// Introduction of SyncPoint effectively disabled building and running this test
// in Release build.
// which is a pity, it is a good test
#if !defined(ROCKSDB_LITE)

#include "yb/rocksdb/db/db_test_util.h"
#include "yb/rocksdb/port/stack_trace.h"

#include "yb/util/test_macros.h"

namespace rocksdb {

class DBTestXactLogIterator : public DBTestBase {
 public:
  DBTestXactLogIterator() : DBTestBase("/db_log_iter_test") {}

  std::unique_ptr<TransactionLogIterator> OpenTransactionLogIter(
      const SequenceNumber seq) {
    unique_ptr<TransactionLogIterator> iter;
    Status status = dbfull()->GetUpdatesSince(seq, &iter);
    EXPECT_OK(status);
    EXPECT_TRUE(iter->Valid());
    return iter;
  }
};

namespace {
SequenceNumber ReadRecords(
    const std::unique_ptr<TransactionLogIterator>& iter,
    int* const count) {
  *count = 0;
  SequenceNumber lastSequence = 0;
  BatchResult res;
  while (iter->Valid()) {
    res = iter->GetBatch();
    EXPECT_TRUE(res.sequence > lastSequence);
    ++*count;
    lastSequence = res.sequence;
    EXPECT_OK(iter->status());
    iter->Next();
  }
  return res.sequence;
}

void ExpectRecords(
    const int expected_no_records,
    const std::unique_ptr<TransactionLogIterator>& iter) {
  int num_records;
  ReadRecords(iter, &num_records);
  ASSERT_EQ(num_records, expected_no_records);
}
}  // namespace

TEST_F(DBTestXactLogIterator, TransactionLogIterator) {
  do {
    Options options = OptionsForLogIterTest();
    DestroyAndReopen(options);
    CreateAndReopenWithCF({"pikachu"}, options);
    ASSERT_OK(Put(0, "key1", DummyString(1024)));
    ASSERT_OK(Put(1, "key2", DummyString(1024)));
    ASSERT_OK(Put(1, "key2", DummyString(1024)));
    ASSERT_EQ(dbfull()->GetLatestSequenceNumber(), 3U);
    {
      auto iter = OpenTransactionLogIter(0);
      ExpectRecords(3, iter);
    }
    ReopenWithColumnFamilies({"default", "pikachu"}, options);
    env_->SleepForMicroseconds(2 * 1000 * 1000);
    {
      ASSERT_OK(Put(0, "key4", DummyString(1024)));
      ASSERT_OK(Put(1, "key5", DummyString(1024)));
      ASSERT_OK(Put(0, "key6", DummyString(1024)));
    }
    {
      auto iter = OpenTransactionLogIter(0);
      ExpectRecords(6, iter);
    }
  } while (ChangeCompactOptions());
}

#ifndef NDEBUG  // sync point is not included with DNDEBUG build
TEST_F(DBTestXactLogIterator, TransactionLogIteratorRace) {
  static const int LOG_ITERATOR_RACE_TEST_COUNT = 2;
  static const char* sync_points[LOG_ITERATOR_RACE_TEST_COUNT][4] = {
      {"WalManager::GetSortedWalFiles:1",  "WalManager::PurgeObsoleteFiles:1",
       "WalManager::PurgeObsoleteFiles:2", "WalManager::GetSortedWalFiles:2"},
      {"WalManager::GetSortedWalsOfType:1",
       "WalManager::PurgeObsoleteFiles:1",
       "WalManager::PurgeObsoleteFiles:2",
       "WalManager::GetSortedWalsOfType:2"}};
  for (int test = 0; test < LOG_ITERATOR_RACE_TEST_COUNT; ++test) {
    // Setup sync point dependency to reproduce the race condition of
    // a log file moved to archived dir, in the middle of GetSortedWalFiles
    rocksdb::SyncPoint::GetInstance()->LoadDependency(
      { { sync_points[test][0], sync_points[test][1] },
        { sync_points[test][2], sync_points[test][3] },
      });

    do {
      rocksdb::SyncPoint::GetInstance()->ClearTrace();
      rocksdb::SyncPoint::GetInstance()->DisableProcessing();
      Options options = OptionsForLogIterTest();
      DestroyAndReopen(options);
      ASSERT_OK(Put("key1", DummyString(1024)));
      ASSERT_OK(dbfull()->Flush(FlushOptions()));
      ASSERT_OK(Put("key2", DummyString(1024)));
      ASSERT_OK(dbfull()->Flush(FlushOptions()));
      ASSERT_OK(Put("key3", DummyString(1024)));
      ASSERT_OK(dbfull()->Flush(FlushOptions()));
      ASSERT_OK(Put("key4", DummyString(1024)));
      ASSERT_EQ(dbfull()->GetLatestSequenceNumber(), 4U);

      {
        auto iter = OpenTransactionLogIter(0);
        ExpectRecords(4, iter);
      }

      rocksdb::SyncPoint::GetInstance()->EnableProcessing();
      // trigger async flush, and log move. Well, log move will
      // wait until the GetSortedWalFiles:1 to reproduce the race
      // condition
      FlushOptions flush_options;
      flush_options.wait = false;
      ASSERT_OK(dbfull()->Flush(flush_options));

      // "key5" would be written in a new memtable and log
      ASSERT_OK(Put("key5", DummyString(1024)));
      {
        // this iter would miss "key4" if not fixed
        auto iter = OpenTransactionLogIter(0);
        ExpectRecords(5, iter);
      }
    } while (ChangeCompactOptions());
  }
}
#endif

TEST_F(DBTestXactLogIterator, TransactionLogIteratorStallAtLastRecord) {
  do {
    Options options = OptionsForLogIterTest();
    DestroyAndReopen(options);
    ASSERT_OK(Put("key1", DummyString(1024)));
    auto iter = OpenTransactionLogIter(0);
    ASSERT_OK(iter->status());
    ASSERT_TRUE(iter->Valid());
    iter->Next();
    ASSERT_TRUE(!iter->Valid());
    ASSERT_OK(iter->status());
    ASSERT_OK(Put("key2", DummyString(1024)));
    iter->Next();
    ASSERT_OK(iter->status());
    ASSERT_TRUE(iter->Valid());
  } while (ChangeCompactOptions());
}

TEST_F(DBTestXactLogIterator, TransactionLogIteratorCheckAfterRestart) {
  do {
    Options options = OptionsForLogIterTest();
    DestroyAndReopen(options);
    ASSERT_OK(Put("key1", DummyString(1024)));
    ASSERT_OK(Put("key2", DummyString(1023)));
    ASSERT_OK(dbfull()->Flush(FlushOptions()));
    Reopen(options);
    auto iter = OpenTransactionLogIter(0);
    ExpectRecords(2, iter);
  } while (ChangeCompactOptions());
}

TEST_F(DBTestXactLogIterator, TransactionLogIteratorCorruptedLog) {
  do {
    Options options = OptionsForLogIterTest();
    DestroyAndReopen(options);
    for (int i = 0; i < 1024; i++) {
      ASSERT_OK(Put("key"+ToString(i), DummyString(10)));
    }
    ASSERT_OK(dbfull()->Flush(FlushOptions()));
    // Corrupt this log to create a gap
    rocksdb::VectorLogPtr wal_files;
    ASSERT_OK(dbfull()->GetSortedWalFiles(&wal_files));
    const auto logfile_path = dbname_ + "/" + wal_files.front()->PathName();
    if (mem_env_) {
      ASSERT_OK(mem_env_->Truncate(logfile_path, wal_files.front()->SizeFileBytes() / 2));
    } else {
      ASSERT_EQ(0, truncate(logfile_path.c_str(),
                   wal_files.front()->SizeFileBytes() / 2));
    }

    // Insert a new entry to a new log file
    ASSERT_OK(Put("key1025", DummyString(10)));
    // Try to read from the beginning. Should stop before the gap and read less
    // than 1025 entries
    auto iter = OpenTransactionLogIter(0);
    int count;
    SequenceNumber last_sequence_read = ReadRecords(iter, &count);
    ASSERT_LT(last_sequence_read, 1025U);
    // Try to read past the gap, should be able to seek to key1025
    auto iter2 = OpenTransactionLogIter(last_sequence_read + 1);
    ExpectRecords(1, iter2);
  } while (ChangeCompactOptions());
}

TEST_F(DBTestXactLogIterator, TransactionLogIteratorBatchOperations) {
  do {
    Options options = OptionsForLogIterTest();
    DestroyAndReopen(options);
    CreateAndReopenWithCF({"pikachu"}, options);
    WriteBatch batch;
    batch.Put(handles_[1], "key1", DummyString(1024));
    batch.Put(handles_[0], "key2", DummyString(1024));
    batch.Put(handles_[1], "key3", DummyString(1024));
    batch.Delete(handles_[0], "key2");
    ASSERT_OK(dbfull()->Write(WriteOptions(), &batch));
    ASSERT_OK(Flush(1));
    ASSERT_OK(Flush(0));
    ReopenWithColumnFamilies({"default", "pikachu"}, options);
    ASSERT_OK(Put(1, "key4", DummyString(1024)));
    auto iter = OpenTransactionLogIter(3);
    ExpectRecords(2, iter);
  } while (ChangeCompactOptions());
}

TEST_F(DBTestXactLogIterator, TransactionLogIteratorBlobs) {
  Options options = OptionsForLogIterTest();
  DestroyAndReopen(options);
  CreateAndReopenWithCF({"pikachu"}, options);
  {
    WriteBatch batch;
    batch.Put(handles_[1], "key1", DummyString(1024));
    batch.Put(handles_[0], "key2", DummyString(1024));
    batch.PutLogData(Slice("blob1"));
    batch.Put(handles_[1], "key3", DummyString(1024));
    batch.PutLogData(Slice("blob2"));
    batch.Delete(handles_[0], "key2");
    ASSERT_OK(dbfull()->Write(WriteOptions(), &batch));
    ReopenWithColumnFamilies({"default", "pikachu"}, options);
  }

  auto res = OpenTransactionLogIter(0)->GetBatch();
  struct Handler : public WriteBatch::Handler {
    std::string seen;
    virtual Status PutCF(uint32_t cf, const SliceParts& key,
                         const SliceParts& value) override {
      seen += "Put(" + ToString(cf) + ", " + key.TheOnlyPart().ToString() + ", " +
              ToString(value.TheOnlyPart().size()) + ")";
      return Status::OK();
    }
    virtual Status MergeCF(uint32_t cf, const Slice& key,
                           const Slice& value) override {
      seen += "Merge(" + ToString(cf) + ", " + key.ToString() + ", " +
              ToString(value.size()) + ")";
      return Status::OK();
    }
    void LogData(const Slice& blob) override {
      seen += "LogData(" + blob.ToString() + ")";
    }
    Status DeleteCF(uint32_t cf, const Slice& key) override {
      seen += "Delete(" + ToString(cf) + ", " + key.ToString() + ")";
      return Status::OK();
    }
  } handler;
  ASSERT_OK(res.writeBatchPtr->Iterate(&handler));
  ASSERT_EQ(
      "Put(1, key1, 1024)"
      "Put(0, key2, 1024)"
      "LogData(blob1)"
      "Put(1, key3, 1024)"
      "LogData(blob2)"
      "Delete(0, key2)",
      handler.seen);
}
}  // namespace rocksdb

#endif  // !defined(ROCKSDB_LITE)

int main(int argc, char** argv) {
#if !defined(ROCKSDB_LITE)
  rocksdb::port::InstallStackTraceHandler();
  ::testing::InitGoogleTest(&argc, argv);
  return RUN_ALL_TESTS();
#else
  return 0;
#endif
}
