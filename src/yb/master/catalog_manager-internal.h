// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.
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
#ifndef YB_MASTER_CATALOG_MANAGER_INTERNAL_H
#define YB_MASTER_CATALOG_MANAGER_INTERNAL_H

#include "yb/common/wire_protocol.h"


#include "yb/master/master_error.h"

namespace yb {

namespace master {

inline CHECKED_STATUS SetupError(MasterErrorPB* error,
                                 MasterErrorPB::Code code,
                                 const Status& s) {
  StatusToPB(s, error->mutable_status());
  error->set_code(code);
  return s;
}

inline CHECKED_STATUS CheckIfNoLongerLeader(const Status& s) {
  // TODO (KUDU-591): This is a bit of a hack, as right now
  // there's no way to propagate why a write to a consensus configuration has
  // failed. However, since we use Status::IllegalState()/IsAborted() to
  // indicate the situation where a write was issued on a node
  // that is no longer the leader, this suffices until we
  // distinguish this cause of write failure more explicitly.
  if (s.IsIllegalState() || s.IsAborted()) {
    return STATUS(ServiceUnavailable,
        "Operation requested can only be executed on a leader master, but this"
        " master is no longer the leader", s.ToString(),
        MasterError(MasterErrorPB::NOT_THE_LEADER));
  }

  return s;
}

// If 's' indicates that the node is no longer the leader, setup
// Service::UnavailableError as the error, set NOT_THE_LEADER as the
// error code and return true.
template<class RespClass>
CHECKED_STATUS CheckIfNoLongerLeaderAndSetupError(const Status& s, RespClass* resp) {
  auto new_status = CheckIfNoLongerLeader(s);
  if (MasterError(new_status) == MasterErrorPB::NOT_THE_LEADER) {
    return SetupError(resp->mutable_error(), MasterErrorPB::NOT_THE_LEADER, new_status);
  }

  return s;
}

}  // namespace master
}  // namespace yb

#endif // YB_MASTER_CATALOG_MANAGER_INTERNAL_H
