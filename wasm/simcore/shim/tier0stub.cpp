#include "tier0/platform.h"
#include "tier0/memalloc.h"
#include "tier0/dbg.h"

#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <malloc.h>

class CSimMemAlloc : public IMemAlloc {
 public:
  void *Alloc(size_t nSize) override { return malloc(nSize); }
  void *Realloc(void *pMem, size_t nSize) override { return realloc(pMem, nSize); }
  void Free(void *pMem) override { free(pMem); }
  void *Expand_NoLongerSupported(void *, size_t) override { return 0; }

  void *Alloc(size_t nSize, const char *, int) override { return malloc(nSize); }
  void *Realloc(void *pMem, size_t nSize, const char *, int) override {
    return realloc(pMem, nSize);
  }
  void Free(void *pMem, const char *, int) override { free(pMem); }
  void *Expand_NoLongerSupported(void *, size_t, const char *, int) override { return 0; }

  size_t GetSize(void *pMem) override { return pMem ? malloc_usable_size(pMem) : 0; }

  void PushAllocDbgInfo(const char *, int) override {}
  void PopAllocDbgInfo() override {}

  long CrtSetBreakAlloc(long) override { return 0; }
  int CrtIsValidHeapPointer(const void *) override { return 1; }
  int CrtIsValidPointer(const void *, unsigned int, int) override { return 1; }
  int CrtCheckMemory() override { return 1; }
  int CrtSetDbgFlag(int) override { return 0; }
  int CrtSetReportMode(int, int) override { return 0; }
  void CrtMemCheckpoint(_CrtMemState *) override {}

  void DumpStats() override {}
  void DumpStatsFileBase(char const *) override {}

  void *CrtSetReportFile(int, void *) override { return 0; }
  void *CrtSetReportHook(void *) override { return 0; }
  int CrtDbgReport(int, const char *, int, const char *, const char *) override { return 0; }

  int heapchk() override { return 1; }

  bool IsDebugHeap() override { return false; }

  void GetActualDbgInfo(const char *&, int &) override {}
  void RegisterAllocation(const char *, int, int, int, unsigned) override {}
  void RegisterDeallocation(const char *, int, int, int, unsigned) override {}

  int GetVersion() override { return 1; }

  void CompactHeap() override {}

  MemAllocFailHandler_t SetAllocFailHandler(MemAllocFailHandler_t) override { return 0; }

  void DumpBlockStats(void *) override {}


  size_t MemoryAllocFailed() override { return 0; }

  uint32 GetDebugInfoSize() override { return 0; }
  void SaveDebugInfo(void *) override {}
  void RestoreDebugInfo(const void *) override {}
  void InitDebugInfo(void *, const char *, int) override {}

  void GlobalMemoryStatus(size_t *pUsedMemory, size_t *pFreeMemory) override {
    if (pUsedMemory) *pUsedMemory = 0;
    if (pFreeMemory) *pFreeMemory = 0;
  }
};

static CSimMemAlloc g_SimMemAlloc;
IMemAlloc *g_pMemAlloc = &g_SimMemAlloc;

#include "edict.h"

#include "server_class.h"
ServerClass *g_pServerClassHead = 0;

#include "engine/IVModelInfo.h"

#include <stdarg.h>

static void SimSpew(const char *prefix, const char *fmt, va_list args) {
  char buf[2048];
  vsnprintf(buf, sizeof(buf), fmt, args);
  fprintf(stderr, "%s%s", prefix, buf);
  fflush(stderr);
}

#define SIM_SPEW_BODY(prefix)      \
  va_list args;                    \
  va_start(args, pMsg);            \
  SimSpew(prefix, pMsg, args);     \
  va_end(args);

void Msg(const tchar *pMsg, ...) { SIM_SPEW_BODY("") }
void Warning(const tchar *pMsg, ...) { SIM_SPEW_BODY("warning: ") }
void Error(const tchar *pMsg, ...) { SIM_SPEW_BODY("error: ") }
void DevMsg(const tchar *pMsg, ...) { SIM_SPEW_BODY("") }
void DevWarning(const tchar *pMsg, ...) { SIM_SPEW_BODY("warning: ") }
void ConMsg(const tchar *pMsg, ...) { SIM_SPEW_BODY("") }
void ConWarning(const tchar *pMsg, ...) { SIM_SPEW_BODY("warning: ") }

void DevMsg(int level, const tchar *pMsg, ...) { SIM_SPEW_BODY("") }
void DevWarning(int level, const tchar *pMsg, ...) { SIM_SPEW_BODY("warning: ") }
void ConMsg(int level, const tchar *pMsg, ...) { SIM_SPEW_BODY("") }
void ConDMsg(const tchar *pMsg, ...) { SIM_SPEW_BODY("") }

#include "tier0/threadtools.h"

ThreadId_t ThreadGetCurrentId() { return 1; }

double g_ClockSpeedMillisecondsMultiplier = 0.0;
double g_ClockSpeedSecondsMultiplier = 0.0;

void *MemAllocScratch(int nMemSize) { return malloc(nMemSize); }
void MemFreeScratch() {}

bool HushAsserts() { return true; }
void COM_TimestampedLog(char const *pMsg, ...) {}

CThreadSyncObject::CThreadSyncObject() {}
CThreadSyncObject::~CThreadSyncObject() {}
bool CThreadEvent::Set() { return true; }
void CThreadRWLock::WaitForRead() {}
CThreadEvent::CThreadEvent(bool bManualReset) {}
void CThreadRWLock::LockForWrite() { m_nWriters = 1; }
void CThreadRWLock::UnlockWrite() { m_nWriters = 0; }
bool Plat_IsInDebugSession() { return false; }

static bool g_SimBenchmarkMode = false;
bool Plat_IsInBenchmarkMode() { return g_SimBenchmarkMode; }
void Plat_SetBenchmarkMode(bool bBenchmarkMode) { g_SimBenchmarkMode = bBenchmarkMode; }

#include "tier0/icommandline.h"
#undef CommandLine

class CSimCommandLine : public ICommandLine {
 public:
  void CreateCmdLine(const char *) override {}
  void CreateCmdLine(int, char **) override {}
  const char *GetCmdLine() const override { return ""; }
  const char *CheckParm(const char *, const char ** = 0) const override { return 0; }
  void RemoveParm(const char *) override {}
  void AppendParm(const char *, const char *) override {}
  const char *ParmValue(const char *, const char *pDefaultVal = 0) const override { return pDefaultVal; }
  int ParmValue(const char *, int nDefaultVal) const override { return nDefaultVal; }
  float ParmValue(const char *, float flDefaultVal) const override { return flDefaultVal; }
  int ParmCount() const override { return 0; }
  int FindParm(const char *) const override { return 0; }
  const char *GetParm(int) const override { return ""; }
  void SetParm(int, char const *) override {}
  const char *ParmValueByIndex(int, const char *pDefaultVal = 0) const override { return pDefaultVal; }
  bool HasParm(const char *) const override { return false; }
  const char **GetParms() const override { return 0; }
  void CreateCmdLine1(const char *, bool) override {}
  void CreateCmdLine1(int, char **, bool) override {}
};

static CSimCommandLine g_SimCommandLine;
ICommandLine *CommandLine_Tier0() { return &g_SimCommandLine; }

unsigned int Plat_MSTime() { return (unsigned int)(Plat_FloatTime() * 1000.0); }

#include <time.h>
double Plat_FloatTime() {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (double)ts.tv_sec + (double)ts.tv_nsec * 1e-9;
}

void CThreadFastMutex::Lock(const uint32 threadId, unsigned nSpinSleepTime) volatile {
  m_ownerID = threadId;
  m_depth = 1;
}

CThreadLocalBase::CThreadLocalBase() : m_index(0) {}
CThreadLocalBase::~CThreadLocalBase() {}

static void *g_SimThreadLocalSlot = 0;
void *CThreadLocalBase::Get() const { return g_SimThreadLocalSlot; }
void CThreadLocalBase::Set(void *value) { g_SimThreadLocalSlot = value; }

void CThreadSpinRWLock::LockForRead() { ++m_lockInfo.m_nReaders; }
void CThreadSpinRWLock::UnlockRead() { --m_lockInfo.m_nReaders; }
void CThreadSpinRWLock::SpinLockForWrite(const uint32 threadId) { m_lockInfo.m_writerId = threadId; }
void CThreadSpinRWLock::UnlockWrite() { m_lockInfo.m_writerId = 0; }

void Log(const tchar *pMsg, ...) { SIM_SPEW_BODY("") }
void LogV(const tchar *pMsg, va_list args) { SimSpew("", pMsg, args); }

void _SpewInfo(SpewType_t type, const tchar *pFile, int line) {}
SpewRetval_t _SpewMessage(const tchar *pMsg, ...) { SIM_SPEW_BODY("") return SPEW_CONTINUE; }
void _ExitOnFatalAssert(const tchar *pFile, int line) {}
bool ShouldUseNewAssertDialog() { return false; }
bool DoNewAssertDialog(const tchar *pFile, int line, const tchar *pExpression) { return false; }
void CallAssertFailedNotifyFunc(const char *pchFile, int nLine, const char *pchMessage) {}

#include "tier0/vprof.h"

CVProfile::CVProfile() : m_Root("Root", 0, NULL, "Unaccounted", 0) {}
CVProfile::~CVProfile() {}
CVProfile g_VProfCurrentProfile;

void CVProfNode::Resume() {}
CVProfNode::~CVProfNode() {}
int CVProfNode::s_iCurrentUniqueNodeID = 0;
int CVProfile::BudgetGroupNameToBudgetGroupID(const char *pBudgetGroupName, int budgetFlagsToORIn) { return 0; }
CL2Cache::CL2Cache() {}
CL2Cache::~CL2Cache() {}

#include "tier0/cpumonitoring.h"
static const CPUInformation g_SimCPUInfo = {};
const CPUInformation *GetCPUInformation() { return &g_SimCPUInfo; }
CVProfNode *CVProfNode::GetSubNode(const tchar *pszName, int detailLevel, const tchar *pBudgetGroupName, int budgetFlags) { return this; }
void CVProfNode::Pause() {}
void CVProfNode::Reset() {}
void CVProfNode::MarkFrame() {}
void CVProfNode::EnterScope() {}
bool CVProfNode::ExitScope() { return true; }
void CVProfile::OutputReport(int type, const tchar *pszStartNode, int budgetGroupID) {}

bool vtune(bool resume) { return false; }

void MsgV(const tchar *pMsg, va_list args) { SimSpew("", pMsg, args); }
void WarningV(const tchar *pMsg, va_list args) { SimSpew("warning: ", pMsg, args); }
void DevMsgV(const tchar *pMsg, va_list args) { SimSpew("", pMsg, args); }
void DevWarningV(const tchar *pMsg, va_list args) { SimSpew("warning: ", pMsg, args); }
