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
