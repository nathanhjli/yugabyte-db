// Copyright (c) YugaByte, Inc.
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

package org.yb.client;

import com.google.protobuf.ByteString;
import com.google.protobuf.Message;
import org.jboss.netty.buffer.ChannelBuffer;
import org.yb.Opid;
import org.yb.cdc.CdcService;
import org.yb.util.Pair;

public class SetCheckpointRequest extends YRpc<SetCheckpointResponse>{
  private String streamId;
  private String tabletId;
  private long index;
  private long term;

  public SetCheckpointRequest(YBTable table, String streamId,
                              String tabletId, long term, long index) {
    super(table);
    this.streamId = streamId;
    this.tabletId = tabletId;
    this.term = term;
    this.index = index;
  }

  @Override
  ChannelBuffer serialize(Message header) {
    assert header.isInitialized();
    final CdcService.SetCDCCheckpointRequestPB.Builder builder = CdcService
      .SetCDCCheckpointRequestPB.newBuilder();
    builder.setStreamId(ByteString.copyFromUtf8(this.streamId));
    builder.setTabletId(ByteString.copyFromUtf8(this.tabletId));
    final CdcService.CDCCheckpointPB.Builder cBuilder = CdcService
      .CDCCheckpointPB.newBuilder();
    builder.setCheckpoint(cBuilder.setOpId(Opid.OpIdPB.newBuilder().setIndex(this.index)
      .setTerm(this.term).build()).build());
    return toChannelBuffer(header, builder.build());
  }

  @Override
  String serviceName() { return CDC_SERVICE_NAME; }

  @Override
  String method() {
    return "SetCDCCheckpoint";
  }

  @Override
  Pair<SetCheckpointResponse, Object> deserialize(CallResponse callResponse,
                                            String uuid) throws Exception {
    final CdcService.SetCDCCheckpointResponsePB.Builder respBuilder =
      CdcService.SetCDCCheckpointResponsePB.newBuilder();
    readProtobuf(callResponse.getPBMessage(), respBuilder);
    SetCheckpointResponse response =
      new SetCheckpointResponse(deadlineTracker.getElapsedMillis(), uuid);
    return new Pair<SetCheckpointResponse, Object>(
      response, respBuilder.hasError() ? respBuilder.getError() : null);
  }
}
