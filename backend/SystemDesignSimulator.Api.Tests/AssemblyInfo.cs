// Integration tests share process-wide environment variables while building
// their hosts (see ApiFactory.CreateHost), so they must not run concurrently.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
